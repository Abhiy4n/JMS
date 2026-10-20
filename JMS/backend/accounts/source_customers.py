from django.db import transaction

from .models import BusinessSource, Customer


@transaction.atomic
def sync_source_customer(source):
    """Lock the stable source ID; reads never create directory entries."""
    # Serialize writes for this source; its one-to-one entry must keep the same ID.
    BusinessSource.objects.select_for_update().get(pk=source.pk)
    customer = Customer.objects.filter(source_entry=source).first()
    if customer is None:
        # Reuse an existing ID and its financial relationships, never match names.
        customer = Customer.objects.filter(business_source=source).order_by("id").first()
    if customer is None:
        customer = Customer(business_source=source)
    customer.source_entry = source
    customer.business_source = source
    customer.name = source.name
    customer.phone = source.phone
    customer.email = source.email
    customer.customer_type = source.source_type
    customer.monthly_interest_amount = source.monthly_interest_amount
    customer.interest_credit_basis = source.interest_credit_basis
    # Do not reset is_active: editing a source must not reactivate its customer.
    customer.save()
    return customer
