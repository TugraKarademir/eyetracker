from django.urls import path

from . import api, views

app_name = "studies"

urlpatterns = [
    # Ogretmen paneli (Faz 3)
    path("panel/", views.dashboard, name="dashboard"),
    path("panel/materyal/<int:material_id>/aoi/", views.aoi_editor, name="aoi_editor"),
    # Analiz ciktilari (Faz 4)
    path("panel/calisma/<int:study_id>/excel/", views.study_excel, name="study_excel"),
    path("panel/calisma/<int:study_id>/csv/", views.study_csv, name="study_csv"),
    path("panel/calisma/<int:study_id>/rq2-csv/", views.study_rq2_csv, name="study_rq2_csv"),
    path("panel/calisma/<int:study_id>/rq3-csv/", views.study_rq3_csv, name="study_rq3_csv"),
    # Rapor ekrani (Faz 5)
    path("panel/calisma/<int:study_id>/rapor/", views.study_report, name="study_report"),
    # Veri kayit API'si (Faz 2)
    path("api/session/baslat/", api.session_start, name="session_start"),
    path("api/session/<int:session_id>/veri/", api.session_data, name="session_data"),
    path("api/session/<int:session_id>/bitir/", api.session_finish, name="session_finish"),
    path("api/session/<int:session_id>/bilissel-yuk/", api.cognitive_load, name="cognitive_load"),
    # AOI API (Faz 3)
    path("api/materyal/<int:material_id>/aoi/", api.aoi_save, name="aoi_save"),
]
