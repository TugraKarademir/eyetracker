from django.contrib import admin
from django.urls import reverse
from django.utils.html import format_html

from .models import AOI, CalibrationResult, GazeSample, Material, Session, Study


class MaterialInline(admin.TabularInline):
    model = Material
    extra = 1
    fields = ("order", "kind", "source", "image", "video", "natural_width", "natural_height")
    readonly_fields = ("natural_width", "natural_height")


@admin.register(Study)
class StudyAdmin(admin.ModelAdmin):
    list_display = ("name", "teacher", "status", "participation_code", "material_count", "session_count", "created_at")
    list_filter = ("status", "teacher")
    search_fields = ("name", "participation_code")
    readonly_fields = ("participation_code", "participation_link", "created_at")
    inlines = [MaterialInline]

    @admin.display(description="Materyal sayisi")
    def material_count(self, obj):
        return obj.materials.count()

    @admin.display(description="Oturum sayisi")
    def session_count(self, obj):
        return obj.sessions.count()

    @admin.display(description="Katilim baglantisi")
    def participation_link(self, obj):
        if not obj.participation_code:
            return "-"
        url = reverse("experiment:run_study", args=[obj.participation_code])
        return format_html('<a href="{0}" target="_blank">{0}</a>', url)

    def save_model(self, request, obj, form, change):
        # Yeni calismada ogretmeni otomatik ata
        if not change and not obj.teacher_id:
            obj.teacher = request.user
        super().save_model(request, obj, form, change)


class CalibrationInline(admin.TabularInline):
    model = CalibrationResult
    extra = 0
    readonly_fields = ("attempt_no", "avg_error_px", "avg_error_norm", "precision", "passed")
    can_delete = False


@admin.register(Session)
class SessionAdmin(admin.ModelAdmin):
    list_display = ("participant_code", "study", "status", "sample_count", "started_at", "finished_at")
    list_filter = ("status", "study")
    search_fields = ("participant_code",)
    readonly_fields = (
        "study", "participant_code", "user_agent", "screen_width", "screen_height",
        "viewport_width", "viewport_height", "device_pixel_ratio", "started_at", "finished_at",
        "client_meta",
    )
    inlines = [CalibrationInline]

    @admin.display(description="Ornek sayisi")
    def sample_count(self, obj):
        return obj.samples.count()


class AOIInline(admin.TabularInline):
    model = AOI
    extra = 0
    fields = ("name", "shape", "is_relevant", "color")


@admin.register(Material)
class MaterialAdmin(admin.ModelAdmin):
    list_display = ("study", "order", "kind", "source", "natural_width", "natural_height", "aoi_count", "aoi_editor_link")
    list_filter = ("study", "kind", "source")
    inlines = [AOIInline]

    @admin.display(description="AOI")
    def aoi_count(self, obj):
        return obj.aois.count()

    @admin.display(description="AOI araci")
    def aoi_editor_link(self, obj):
        from django.urls import reverse
        url = reverse("studies:aoi_editor", args=[obj.id])
        return format_html('<a href="{}" target="_blank">AOI ciz</a>', url)


@admin.register(AOI)
class AOIAdmin(admin.ModelAdmin):
    list_display = ("name", "material", "shape", "is_relevant", "color")
    list_filter = ("shape", "is_relevant", "material__study")


# GazeSample cok sayida satir uretir; admin'de yalnizca okunur ozet.
@admin.register(GazeSample)
class GazeSampleAdmin(admin.ModelAdmin):
    list_display = ("session", "material", "t", "x_norm", "y_norm", "in_material")
    list_filter = ("in_material", "material")
    list_select_related = ("session", "material")
