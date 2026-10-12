from django.urls import path

from . import views

urlpatterns = [
    path("portal/summary/", views.PortalSummaryView.as_view(), name="portal-summary"),
    path("portal/projects/", views.PortalProjectListView.as_view(), name="portal-projects"),
    path(
        "portal/projects/<uuid:pk>/", views.PortalProjectDetailView.as_view(), name="portal-project"
    ),
    path(
        "portal/projects/<uuid:pk>/releases/",
        views.PortalReleaseListView.as_view(),
        name="portal-project-releases",
    ),
    path(
        "portal/projects/<uuid:pk>/demo-access/",
        views.PortalDemoAccessView.as_view(),
        name="portal-demo-access",
    ),
    path(
        "integrations/demo-access/redeem/",
        views.DemoRedeemView.as_view(),
        name="integration-demo-redeem",
    ),
    path("public/portfolio/", views.PublicPortfolioView.as_view(), name="public-portfolio"),
]
