from django.urls import reverse
from rest_framework.test import APITestCase

from .models import BusinessSource, Customer, User


class BusinessSourceCustomerLinkTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email="team@example.com",
            name="Team member",
            password="test-password-123",
        )
        self.client.force_authenticate(user=self.user)

    def test_creating_source_also_creates_its_first_customer(self):
        response = self.client.post(
            reverse("business-source-list"),
            {
                "name": "Walk-in Customer",
                "channel_type": BusinessSource.ChannelType.DIRECT,
                "first_customer": {
                    "name": "Asha Rai",
                    "phone": "9800000000",
                    "email": "asha@example.com",
                },
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        source = BusinessSource.objects.get(name="Walk-in Customer")
        customer = Customer.objects.get(name="Asha Rai")
        self.assertEqual(customer.business_source, source)
        self.assertEqual(response.data["customer_count"], 1)
        self.assertEqual(source.created_by, self.user)

    def test_customer_creation_updates_source_count_and_detail_list(self):
        source = BusinessSource.objects.create(
            name="Facebook",
            channel_type=BusinessSource.ChannelType.MARKETING,
        )

        response = self.client.post(
            reverse("customer-list"),
            {
                "name": "Bikash Thapa",
                "phone": "9811111111",
                "email": "bikash@example.com",
                "business_source": source.id,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        source_response = self.client.get(reverse("business-source-list"))
        self.assertEqual(source_response.status_code, 200)
        self.assertEqual(source_response.data[0]["customer_count"], 1)

        customer_response = self.client.get(
            reverse("customer-list"), {"business_source": source.id}
        )
        self.assertEqual(customer_response.status_code, 200)
        self.assertEqual(len(customer_response.data), 1)
        self.assertEqual(customer_response.data[0]["source_name"], "Facebook")