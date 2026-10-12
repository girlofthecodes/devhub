from rest_framework import serializers

from apps.users.models import User

from .models import Membership, MembershipRole, Organization


class OrganizationSerializer(serializers.ModelSerializer):
    member_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Organization
        fields = [
            "id",
            "name",
            "slug",
            "description",
            "contact_email",
            "is_active",
            "member_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "is_active", "member_count", "created_at", "updated_at"]
        extra_kwargs = {"slug": {"required": False, "validators": []}}


class OrganizationUpdateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=150, required=False)
    description = serializers.CharField(allow_blank=True, required=False)
    contact_email = serializers.EmailField(allow_blank=True, required=False)


class MemberUserSerializer(serializers.ModelSerializer):
    role = serializers.CharField(read_only=True)
    full_name = serializers.CharField(read_only=True)

    class Meta:
        model = User
        fields = ["id", "email", "full_name", "role", "is_active"]
        read_only_fields = fields


class MembershipSerializer(serializers.ModelSerializer):
    user_detail = MemberUserSerializer(source="user", read_only=True)
    organization_name = serializers.CharField(source="organization.name", read_only=True)

    class Meta:
        model = Membership
        fields = [
            "id",
            "organization",
            "organization_name",
            "user",
            "user_detail",
            "role",
            "created_at",
        ]
        read_only_fields = ["id", "organization_name", "user_detail", "created_at"]
        # Uniqueness is enforced (with a friendlier message) by the service layer.
        validators = []


class MembershipUpdateSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=MembershipRole.choices)
