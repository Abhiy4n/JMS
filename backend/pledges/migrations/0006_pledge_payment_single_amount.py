from decimal import Decimal

from django.db import migrations, models
import django.db.models.deletion
import django.core.validators


def split_legacy_payments(apps, schema_editor):
    Payment = apps.get_model("pledges", "PledgePayment")
    EditLog = apps.get_model("pledges", "PledgeEditLog")
    database = schema_editor.connection.alias

    payments = list(Payment.objects.using(database).order_by("id"))
    for payment in payments:
        principal_amount = Decimal(payment.principal_amount)
        interest_amount = Decimal(payment.interest_amount)
        has_principal = principal_amount > 0
        has_interest = interest_amount > 0

        if has_principal:
            payment.type = "PRINCIPAL"
            payment.amount = principal_amount
            payment.save(using=database, update_fields=("type", "amount"))
        else:
            payment.type = "INTEREST"
            payment.amount = interest_amount
            payment.save(using=database, update_fields=("type", "amount"))

        if not (has_principal and has_interest):
            for log in EditLog.objects.using(database).filter(payment_id=payment.pk):
                old_field = "principal_amount" if has_principal else "interest_amount"
                if log.field == old_field:
                    log.field = "amount"
                    log.save(using=database, update_fields=("field",))
            continue

        interest_payment = Payment.objects.using(database).create(
            pledge_id=payment.pledge_id,
            payment_date=payment.payment_date,
            type="INTEREST",
            amount=interest_amount,
            is_voided=payment.is_voided,
            created_by_id=payment.created_by_id,
        )
        Payment.objects.using(database).filter(pk=interest_payment.pk).update(created_at=payment.created_at)

        logs = list(EditLog.objects.using(database).filter(payment_id=payment.pk).order_by("id"))
        for log in logs:
            if log.field == "interest_amount":
                log.payment_id = interest_payment.pk
                log.field = "amount"
                log.save(using=database, update_fields=("payment", "field"))
            elif log.field == "principal_amount":
                log.field = "amount"
                log.save(using=database, update_fields=("field",))
            elif log.field in ("payment_date", "is_voided"):
                duplicate = EditLog.objects.using(database).create(
                    pledge_id=log.pledge_id,
                    payment_id=interest_payment.pk,
                    edit_id=log.edit_id,
                    field=log.field,
                    old_value=log.old_value,
                    new_value=log.new_value,
                    effective_date=log.effective_date,
                    changed_by_id=log.changed_by_id,
                    reason=log.reason,
                )
                EditLog.objects.using(database).filter(pk=duplicate.pk).update(changed_at=log.changed_at)


def restore_legacy_payment_amounts(apps, schema_editor):
    Payment = apps.get_model("pledges", "PledgePayment")
    EditLog = apps.get_model("pledges", "PledgeEditLog")
    database = schema_editor.connection.alias

    for payment in Payment.objects.using(database).all():
        is_principal = payment.type == "PRINCIPAL"
        Payment.objects.using(database).filter(pk=payment.pk).update(
            principal_amount=payment.amount if is_principal else Decimal("0.00"),
            interest_amount=payment.amount if not is_principal else Decimal("0.00"),
        )
        EditLog.objects.using(database).filter(
            payment_id=payment.pk,
            field="amount",
        ).update(field="principal_amount" if is_principal else "interest_amount")


class Migration(migrations.Migration):

    dependencies = [
        ("pledges", "0005_pledge_paper_form_fields"),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="pledgepayment",
            name="pledge_payment_amounts_nonnegative",
        ),
        migrations.RemoveConstraint(
            model_name="pledgepayment",
            name="pledge_payment_not_empty",
        ),
        migrations.AddField(
            model_name="pledgepayment",
            name="type",
            field=models.CharField(
                choices=[("PRINCIPAL", "Principal"), ("INTEREST", "Interest")],
                max_length=9,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="pledgepayment",
            name="amount",
            field=models.DecimalField(
                decimal_places=2,
                max_digits=14,
                null=True,
                validators=[django.core.validators.MinValueValidator(Decimal("0.01"))],
            ),
        ),
        migrations.RunPython(split_legacy_payments, restore_legacy_payment_amounts),
        migrations.RemoveField(
            model_name="pledgepayment",
            name="interest_amount",
        ),
        migrations.RemoveField(
            model_name="pledgepayment",
            name="principal_amount",
        ),
        migrations.RenameField(
            model_name="pledgepayment",
            old_name="created_by",
            new_name="recorded_by",
        ),
        migrations.RenameField(
            model_name="pledgepayment",
            old_name="created_at",
            new_name="recorded_at",
        ),
        migrations.AlterField(
            model_name="pledgepayment",
            name="type",
            field=models.CharField(
                choices=[("PRINCIPAL", "Principal"), ("INTEREST", "Interest")],
                max_length=9,
            ),
        ),
        migrations.AlterField(
            model_name="pledgepayment",
            name="amount",
            field=models.DecimalField(
                decimal_places=2,
                max_digits=14,
                validators=[django.core.validators.MinValueValidator(Decimal("0.01"))],
            ),
        ),
        migrations.AlterModelOptions(
            name="pledgepayment",
            options={"ordering": ["payment_date", "recorded_at", "id"]},
        ),
        migrations.AddConstraint(
            model_name="pledgepayment",
            constraint=models.CheckConstraint(
                condition=models.Q(("amount__gt", 0)),
                name="pledge_payment_amount_positive",
            ),
        ),
    ]
