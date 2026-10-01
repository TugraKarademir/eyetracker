from django.urls import path

from . import api

app_name = "studies"

urlpatterns = [
    path("api/session/baslat/", api.session_start, name="session_start"),
    path("api/session/<int:session_id>/veri/", api.session_data, name="session_data"),
    path("api/session/<int:session_id>/bitir/", api.session_finish, name="session_finish"),
]
