from rest_framework.routers import SimpleRouter

from .views import ProjectAccessViewSet, ProjectMemberViewSet, ProjectViewSet

router = SimpleRouter()
router.register("projects", ProjectViewSet, basename="project")
router.register("project-members", ProjectMemberViewSet, basename="project-member")
router.register("project-access", ProjectAccessViewSet, basename="project-access")

urlpatterns = router.urls
