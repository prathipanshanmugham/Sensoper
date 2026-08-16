"""Unit tests for Iter 39 additions — sales math + CAC divide-by-zero."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from sales import _compute_line, _split_gst, _round


def test_compute_line_taxable_and_gst():
    line = {"quantity": 2, "unit_price": 15000, "discount_pct": 0,
            "gst_percentage": 18, "cost_price": 0}
    out = _compute_line(dict(line))
    assert out["line_total"] == 35400.0
    assert out["gst_amount"] == 5400.0
    # No cost snapshot yet → margin equals taxable
    assert out["margin_amount"] == 30000.0


def test_compute_line_with_discount():
    line = {"quantity": 1, "unit_price": 100000, "discount_pct": 10,
            "gst_percentage": 18, "cost_price": 60000}
    out = _compute_line(dict(line))
    # 100000 -10% = 90000; +18% GST = 106200
    assert out["line_total"] == 106200.0
    assert out["margin_amount"] == 30000.0
    assert out["margin_pct"] == round(30000 / 90000 * 100, 2)


def test_intra_state_gst_splits_cgst_sgst():
    lines = [{"gst_amount": 1800}, {"gst_amount": 2700}]
    cgst, sgst, igst = _split_gst(lines, "Tamil Nadu", "Tamil Nadu")
    assert cgst == 2250.0
    assert sgst == 2250.0
    assert igst == 0


def test_inter_state_gst_goes_to_igst():
    lines = [{"gst_amount": 1800}, {"gst_amount": 2700}]
    cgst, sgst, igst = _split_gst(lines, "Karnataka", "Tamil Nadu")
    assert cgst == 0 and sgst == 0
    assert igst == 4500.0


# ── CAC computation guards ──────────────────────────────────────────
from server import _round_v  # noqa: E402


def test_round_v_none_safety():
    assert _round_v(None) == 0
    assert _round_v("") == 0
    assert _round_v(123.456) == 123.46


def test_cac_divide_by_zero():
    """CAC = spend/customers should be None when customers == 0, never crash."""
    def _safe(a, b):
        return _round_v(a / b) if b else None
    assert _safe(50000, 0) is None
    assert _safe(0, 5) == 0
    assert _safe(50000, 10) == 5000.0
