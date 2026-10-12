from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from .models import User
from .roles import Role


class OrganizationSummarySerializer(serializers.Serializer):
    id = serializers.UUIDField()
    name = serializers.CharField()
    slug = serializers.CharField()
    membership_role = serializers.CharField()


class UserSerializer(serializers.ModelSerializer):
    role = serializers.CharField(read_only=True)
    role_label = serializers.SerializerMethodField()
    full_name = serializers.CharField(read_only=True)

    class Meta:
        model = User
        fields = [
            "id",
            "email",
            "first_name",
            "last_name",
            "full_name",
            "role",
            "role_label",
            "is_active",
            "date_joined",
            "last_login",
        ]
        read_only_fields = fields

    def get_role_label(self, obj: User) -> str:
        return Role(obj.role).label if obj.role else ""


class MeSerializer(UserSerializer):
    organizations = serializers.SerializerMethodField()

    class Meta(UserSerializer.Meta):
        fields = [*UserSerializer.Meta.fields, "organizations"]
        read_only_fields = fields

    @extend_schema_field(OrganizationSummarySerializer(many=True))
    def get_organizations(self, obj: User) -> list[dict]:
        memberships = obj.memberships.select_related("organization").filter(
            organization__is_active=True
        )
        return [
            {
                "id": m.organization.id,
                "name": m.organization.name,
                "slug": m.organization.slug,
                "membership_role": m.role,
            }
            for m in memberships
        ]


class ProfileUpdateSerializer(serializers.Serializer):
    first_name = serializers.CharField(max_length=150, allow_blank=True, required=False)
    last_name = serializers.CharField(max_length=150, allow_blank=True, required=False)


class UserCreateSerializer(serializers.Serializer):
    email = serializers.EmailField()
    first_name = serializers.CharField(max_length=150, allow_blank=True, required=False, default="")
    last_name = serializers.CharField(max_length=150, allow_blank=True, required=False, default="")
    role = serializers.ChoiceField(choices=Role.choices)
    password = serializers.CharField(
        write_only=True,
        required=False,
        allow_blank=True,
        style={"input_type": "password"},
        help_text="Opcional. Si se omite, el usuario deberá usar la recuperación de contraseña.",
    )


class UserUpdateSerializer(serializers.Serializer):
    first_name = serializers.CharField(max_length=150, allow_blank=True, required=False)
    last_name = serializers.CharField(max_length=150, allow_blank=True, required=False)
    role = serializers.ChoiceField(choices=Role.choices, required=False)


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(style={"input_type": "password"}, trim_whitespace=False)


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(trim_whitespace=False)
    new_password = serializers.CharField(trim_whitespace=False)


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()
    new_password = serializers.CharField(trim_whitespace=False)


class RoleSerializer(serializers.Serializer):
    value = serializers.CharField()
    label = serializers.CharField()


class DetailSerializer(serializers.Serializer):
    detail = serializers.CharField()
