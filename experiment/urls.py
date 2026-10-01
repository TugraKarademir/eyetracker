from django.urls import path

from . import views

app_name = "experiment"

urlpatterns = [
    path("dene/", views.run_experiment, name="run"),
]
