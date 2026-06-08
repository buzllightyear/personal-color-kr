"""Trend-drop retention event package (Sub-AC 3a).

Retention vehicle
-----------------
월간 매거진 폐기 → *트렌드 드롭*.
A trend drop is an event-triggered re-engagement push: when the operator
identifies a new trend, they push a recipe and the app alerts subscribed users
with "방금 떴어, 네 셀카 restyle" copy.

v1 = semi-automatic (operator manually pushes recipe → notification fires).
Full automation = v2.
"""

from api.trend_drop.model import TrendDrop
from api.trend_drop.notification import (
    make_trend_drop_in_app_alert,
    make_trend_drop_push_notification,
)

__all__ = [
    "TrendDrop",
    "make_trend_drop_push_notification",
    "make_trend_drop_in_app_alert",
]
