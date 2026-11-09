from pydantic import BaseModel


class ClientInfoResponse(BaseModel):
    """What the mobile app checks at start (docs/mobile-release.md)."""

    # Older app versions show "Update required" and stop.
    min_mobile_version: str
    # The newest published version, named on that screen.
    latest_mobile_version: str
    # Where to get it: the Play Store listing, or the test releases until then.
    mobile_update_url: str
