import ipaddress
import re
from functools import lru_cache
from pathlib import Path
from urllib.parse import unquote

from django.conf import settings
from django.utils.crypto import salted_hmac


def _networks(setting_name):
    networks = []
    for value in getattr(settings, setting_name, []):
        try:
            networks.append(ipaddress.ip_network(value.strip(), strict=False))
        except (AttributeError, ValueError):
            continue
    return networks


def _is_in_networks(address, networks):
    return any(address in network for network in networks)


def _trusted_proxy(request):
    try:
        remote = ipaddress.ip_address(request.META.get("REMOTE_ADDR", ""))
    except ValueError:
        return False
    return _is_in_networks(remote, _networks("AUTH_TRUSTED_PROXY_IPS"))


def get_client_ip(request):
    """Return a validated client IP, honoring XFF only from configured proxies."""

    remote_value = request.META.get("REMOTE_ADDR", "")
    try:
        remote = ipaddress.ip_address(remote_value)
    except ValueError:
        return None

    trusted = _networks("AUTH_TRUSTED_PROXY_IPS")
    if not trusted or not _is_in_networks(remote, trusted):
        return str(remote)

    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    addresses = []
    for value in forwarded.split(","):
        try:
            addresses.append(ipaddress.ip_address(value.strip()))
        except ValueError:
            continue
    addresses.append(remote)

    while len(addresses) > 1 and _is_in_networks(addresses[-1], trusted):
        addresses.pop()
    return str(addresses[-1])


def _first_match(user_agent, choices, fallback):
    for pattern, label in choices:
        if re.search(pattern, user_agent, re.IGNORECASE):
            return label
    return fallback


def parse_user_agent(value):
    user_agent = (value or "")[:512]
    browser = _first_match(
        user_agent,
        (
            (r"Edg(?:e|A|iOS)?/", "Microsoft Edge"),
            (r"OPR/|Opera", "Opera"),
            (r"Firefox/|FxiOS/", "Firefox"),
            (r"Chrome/|CriOS/", "Chrome"),
            (r"Safari/", "Safari"),
        ),
        "Unknown browser",
    )
    operating_system = _first_match(
        user_agent,
        (
            (r"iPhone|iPad|iPod", "iOS"),
            (r"Android", "Android"),
            (r"Windows NT", "Windows"),
            (r"Mac OS X|Macintosh", "macOS"),
            (r"Linux", "Linux"),
        ),
        "Unknown OS",
    )
    if re.search(r"iPad|Tablet|Android(?!.*Mobile)", user_agent, re.IGNORECASE):
        device_type = "tablet"
    elif re.search(r"Mobile|iPhone|Android", user_agent, re.IGNORECASE):
        device_type = "mobile"
    elif user_agent:
        device_type = "desktop"
    else:
        device_type = "unknown"
    device_name = f"{browser} on {operating_system}"
    if browser == "Unknown browser" and operating_system == "Unknown OS":
        device_name = "Unknown device"

    return {
        "user_agent": user_agent,
        "browser": browser,
        "operating_system": operating_system,
        "device_type": device_type,
        "device_name": device_name,
    }


@lru_cache(maxsize=1)
def _geoip_reader(database_path):
    try:
        import geoip2.database
    except ImportError:
        return None
    try:
        return geoip2.database.Reader(database_path)
    except (OSError, ValueError):
        return None


def get_ip_location(ip_value):
    if not ip_value:
        return ""
    try:
        address = ipaddress.ip_address(ip_value)
    except ValueError:
        return ""
    if not address.is_global:
        return ""

    database_path = getattr(settings, "AUTH_GEOIP2_DATABASE", "")
    if not database_path or not Path(database_path).is_file():
        return ""
    reader = _geoip_reader(str(database_path))
    if reader is None:
        return ""
    try:
        result = reader.city(str(address))
    except Exception:  # GeoIP lookup errors must never prevent authentication.
        return ""
    parts = [result.city.name, result.country.name]
    return ", ".join(part for part in parts if part)[:255]


def _clean_location_part(value):
    part = unquote(value or "").strip()
    if not part or part.upper() in {"XX", "T1", "UNKNOWN"}:
        return ""
    # Location headers are display-only, but strip control characters so a
    # proxy cannot inject misleading line breaks into activity responses.
    return re.sub(r"[\x00-\x1f\x7f]", "", part)[:100]


def get_proxy_location(request):
    """Use geolocation headers only when they came through a trusted proxy."""

    if not _trusted_proxy(request):
        return ""

    header_sets = (
        ("HTTP_CF_IPCITY", "HTTP_CF_REGION", "HTTP_CF_IPCOUNTRY"),
        (
            "HTTP_X_VERCEL_IP_CITY",
            "HTTP_X_VERCEL_IP_COUNTRY_REGION",
            "HTTP_X_VERCEL_IP_COUNTRY",
        ),
    )
    for header_names in header_sets:
        parts = []
        for header_name in header_names:
            part = _clean_location_part(request.META.get(header_name, ""))
            if part and part not in parts:
                parts.append(part)
        if parts:
            return ", ".join(parts)[:255]
    return ""


def get_request_metadata(request):
    metadata = parse_user_agent(request.META.get("HTTP_USER_AGENT", ""))
    metadata["ip_address"] = get_client_ip(request)
    metadata["location"] = get_proxy_location(request) or get_ip_location(
        metadata["ip_address"]
    )
    fingerprint = "|".join(
        (metadata["browser"], metadata["operating_system"], metadata["device_type"])
    ).lower()
    metadata["device_hash"] = salted_hmac(
        "accounts.device",
        fingerprint,
        secret=settings.AUTH_SESSION_HASH_KEY,
        algorithm="sha256",
    ).hexdigest()
    return metadata
