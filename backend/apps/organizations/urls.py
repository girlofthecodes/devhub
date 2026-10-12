from rest_framework.routers import SimpleRouter

from .views import MembershipViewSet, OrganizationViewSet

router = SimpleRouter()
router.register("organizations", OrganizationViewSet, basename="organization")
router.register("memberships", MembershipViewSet, basename="membership")

urlpatterns = router.urls
