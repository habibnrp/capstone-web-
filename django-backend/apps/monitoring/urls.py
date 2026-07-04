from django.urls import path

from . import views

urlpatterns = [
    path("ingest/", views.ingest, name="ingest"),
    path("realtime/", views.realtime, name="realtime"),
    path("historical/", views.historical, name="historical"),
    path("topics/", views.topics, name="topics"),
    path("signup/", views.signup, name="signup"),
    path("signup/verify-otp/", views.signup_verify_otp, name="signup_verify_otp"),
    path("login/", views.login_view, name="login"),
    # Admin APIs
    path("admin/users/", views.admin_users, name="admin_users"),
    path("admin/users/<int:user_id>/", views.admin_user_detail, name="admin_user_detail"),
    path("admin/settings/", views.admin_settings, name="admin_settings"),
    path("admin/test-telegram/", views.admin_test_telegram, name="admin_test_telegram"),
    path("admin/sensors/", views.admin_sensors, name="admin_sensors"),
    path("admin/sensors/calibrate/", views.admin_sensor_calibrate, name="admin_sensor_calibrate"),
    path("admin/sensors/configure/", views.admin_sensor_configure, name="admin_sensor_configure"),
    path("admin/logs/", views.admin_logs, name="admin_logs"),
]
