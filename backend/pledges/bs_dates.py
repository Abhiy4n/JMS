import re
from datetime import date, datetime

import nepali_datetime
from rest_framework import serializers


_BS_DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def bs_to_ad(value):
    if isinstance(value, nepali_datetime.date):
        bs_date = value
    elif isinstance(value, str) and _BS_DATE_PATTERN.fullmatch(value):
        try:
            year, month, day = (int(part) for part in value.split("-"))
            bs_date = nepali_datetime.date(year, month, day)
        except ValueError as exc:
            raise ValueError("Enter a valid Bikram Sambat date between 1975-01-01 and 2100-12-30.") from exc
    else:
        raise ValueError("Enter a Bikram Sambat date in YYYY-MM-DD format.")
    if not nepali_datetime.date.min <= bs_date <= nepali_datetime.date.max:
        raise ValueError("Date must be between 1975-01-01 and 2100-12-30 BS.")
    try:
        return bs_date.to_datetime_date()
    except ValueError as exc:
        raise ValueError("Date is outside the supported Bikram Sambat range (1975-2100).") from exc


def ad_to_bs(value):
    if isinstance(value, datetime):
        value = value.date()
    if not isinstance(value, date):
        raise TypeError("Expected a Gregorian date.")
    try:
        return nepali_datetime.date.from_datetime_date(value).isoformat()
    except ValueError as exc:
        raise ValueError("Gregorian date is outside the supported Bikram Sambat range (1975-2100).") from exc


def bs_elapsed_days(start_date, end_date):
    start = nepali_datetime.date.from_datetime_date(start_date)
    end = nepali_datetime.date.from_datetime_date(end_date)
    start_number = 360 * start.year + 30 * start.month + min(start.day, 30)
    end_number = 360 * end.year + 30 * end.month + min(end.day, 30)
    return end_number - start_number


def bs_date_after_360_days(value, days):
    bs_date = nepali_datetime.date.from_datetime_date(value)
    month_index = bs_date.year * 12 + bs_date.month - 1
    day_offset = min(bs_date.day, 30) - 1 + days
    month_index += day_offset // 30
    day = day_offset % 30 + 1
    year, month = divmod(month_index, 12)
    return nepali_datetime.date(year, month + 1, day).to_datetime_date()


def bs_month_calendar(year, month):
    if not isinstance(year, int) or not isinstance(month, int) or not 1 <= month <= 12:
        raise ValueError("Enter a valid Bikram Sambat year and month.")
    try:
        first_day = nepali_datetime.date(year, month, 1)
        first_weekday = (first_day.to_datetime_date().weekday() + 1) % 7
        days = []
        for day in range(1, 32):
            try:
                calendar_day = nepali_datetime.date(year, month, day)
            except ValueError:
                break
            days.append(calendar_day.day)
    except ValueError as exc:
        raise ValueError("Calendar month must be between 1975-01 and 2100-12 BS.") from exc
    return {"year": year, "month": month, "first_weekday": first_weekday, "days": days}


class BSDateField(serializers.DateField):
    def to_internal_value(self, value):
        try:
            return bs_to_ad(value)
        except (TypeError, ValueError) as exc:
            raise serializers.ValidationError(str(exc)) from exc

    def to_representation(self, value):
        if value is None:
            return None
        try:
            return ad_to_bs(value)
        except (TypeError, ValueError) as exc:
            raise AssertionError(str(exc)) from exc
