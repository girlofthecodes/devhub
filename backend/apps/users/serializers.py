from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from common.permissions import FinanceAccess, finance_access_level

from .models import User
from .portals import Portal, available_portals
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
    client_portal_access = serializers.SerializerMethodField()
    finance_access = serializers.SerializerMethodField()

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
            "client_portal_access",
            "finance_access",
            "is_active",
            "date_joined",
            "last_login",
        ]
        read_only_fields = fields

    def get_role_label(self, obj: User) -> str:
        return Role(obj.role).label if obj.role else ""

    def get_client_portal_access(self, obj: User) -> bool:
        return any(g.name == Role.CLIENT for g in obj.groups.all())

    @extend_schema_field(serializers.ChoiceField(choices=FinanceAccess.choices))
    def get_finance_access(self, obj: User) -> str:
        return finance_access_level(obj)


class MeSerializer(UserSerializer):
    organizations = serializers.SerializerMethodField()
    portal = serializers.SerializerMethodField()
    available_portals = serializers.SerializerMethodField()

    class Meta(UserSerializer.Meta):
        fields = [*UserSerializer.Meta.fields, "organizations", "portal", "available_portals"]
        read_only_fields = fields

    @extend_schema_field(serializers.ChoiceField(choices=Portal.choices, allow_null=True))
    def get_portal(self, obj: User) -> str | None:
        return obj.__dict__.get("portal")

    @extend_schema_field(serializers.ListField(child=serializers.CharField()))
    def get_available_portals(self, obj: User) -> list[str]:
        return available_portals(obj)

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
    client_portal_access = serializers.BooleanField(
        required=False,
        default=False,
        help_text="Acceso adicional al portal de clientes (solo ADMIN o DEVELOPER).",
    )
    finance_access = serializers.ChoiceField(
        choices=FinanceAccess.choices,
        required=False,
        default=FinanceAccess.NONE,
        help_text="Permisos financieros explícitos (solo DEVELOPER; ADMIN los tiene siempre).",
    )


class UserUpdateSerializer(serializers.Serializer):
    first_name = serializers.CharField(max_length=150, allow_blank=True, required=False)
    last_name = serializers.CharField(max_length=150, allow_blank=True, required=False)
    role = serializers.ChoiceField(choices=Role.choices, required=False)
    client_portal_access = serializers.BooleanField(required=False)
    finance_access = serializers.ChoiceField(choices=FinanceAccess.choices, required=False)


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
