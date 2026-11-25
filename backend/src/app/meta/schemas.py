from pydantic import BaseModel


class ClientInfoResponse(BaseModel):
    """What a client checks before sign-in: the mobile app's update gate
    (docs/mobile-release.md) and which sign-in methods are on."""

    # Older app versions show "Update required" and stop.
    min_mobile_version: str
    # The newest published version, named on that screen.
    latest_mobile_version: str
    # Where to get it: the Play Store listing, or the test releases until then.
    mobile_update_url: str
    # Sign in with Google: the OAuth client ids, null while it's off (public values).
    google_client_id_web: str | None = None
    google_client_id_android: str | None = None
