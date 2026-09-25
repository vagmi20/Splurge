"""
Personal Finance Dashboard
A local desktop app for managing paychecks, investments, budgets, and spending.
Data is stored in finance_data.json in the same directory as this script.
"""

import customtkinter as ctk
import json
import os
import math
from datetime import datetime, date
from matplotlib.figure import Figure
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
import matplotlib.pyplot as plt
import matplotlib
matplotlib.use("TkAgg")
from data_manager import parse_amount
from budget_utils import calculate_remaining_budget, CATEGORY_MAPPING
from data_manager import export_to_excel

# ── Data file ──────────────────────────────────────────────────────────────────
DATA_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "finance_data.json")

DEFAULT_DATA = {
    "paychecks": [],          # {id, name, amount, frequency, next_date, notes}
    "investments": [],         # {id, name, type, value, monthly_contribution, notes}
    "spending": [],            # {id, category, amount, date, notes}
    "subscriptions": [],       # {id, name, category, amount, active, notes}
    "budget_sliders": {
        "needs": 50,
        "wants": 30,
        "savings": 20
    },
    "spending_categories": ["Food", "Gas", "Transit/Parking", "Entertainment", "Clothing", "Drinks", "Other", "Alcohol"]
}

def load_data():
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, "r") as f:
            data = json.load(f)
        # Ensure all keys exist (for upgrades)
        for k, v in DEFAULT_DATA.items():
            if k not in data:
                data[k] = v
        return data
    return json.loads(json.dumps(DEFAULT_DATA))

def save_data(data):
    with open(DATA_FILE, "w") as f:
        json.dump(data, f, indent=2)

# ── Theme ──────────────────────────────────────────────────────────────────────
ctk.set_appearance_mode("dark")
ctk.set_default_color_theme("blue")

COLORS = {
    "bg":       "#0f1117",
    "surface":  "#1a1d27",
    "card":     "#22263a",
    "accent":   "#4f8ef7",
    "accent2":  "#34d399",
    "accent3":  "#f87171",
    "accent4":  "#fbbf24",
    "text":     "#e8eaf6",
    "muted":    "#6b7280",
    "border":   "#2d3148",
}

FONT_TITLE  = ("Georgia", 22, "bold")
FONT_HEAD   = ("Georgia", 14, "bold")
FONT_BODY   = ("Helvetica Neue", 12)
FONT_SMALL  = ("Helvetica Neue", 10)
FONT_MONO   = ("Courier New", 11)
FONT_NUM    = ("Georgia", 18, "bold")

# ── Helpers ────────────────────────────────────────────────────────────────────
def make_id():
    return str(int(datetime.now().timestamp() * 1000))

def fmt_money(v):
    try:
        return f"${float(v):,.2f}"
    except Exception:
        return "$0.00"

def card_frame(parent, **kw):
    return ctk.CTkFrame(parent, fg_color=COLORS["card"],
                        corner_radius=12, **kw)

def section_label(parent, text):
    return ctk.CTkLabel(parent, text=text, font=FONT_HEAD,
                        text_color=COLORS["accent"])

def body_label(parent, text, **kw):
    return ctk.CTkLabel(parent, text=text, font=FONT_BODY,
                        text_color=COLORS["text"], **kw)

def muted_label(parent, text, **kw):
    return ctk.CTkLabel(parent, text=text, font=FONT_SMALL,
                        text_color=COLORS["muted"], **kw)

# ── Main App ───────────────────────────────────────────────────────────────────
class FinanceApp(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.data = load_data()
        self.title("💰 Personal Finance Dashboard")
        self.geometry("1100x750")
        self.minsize(900, 650)
        self.configure(fg_color=COLORS["bg"])

        self._build_layout()

    def _build_layout(self):
        # Sidebar
        self.sidebar = ctk.CTkFrame(self, width=190, fg_color=COLORS["surface"],
                                    corner_radius=0)
        self.sidebar.pack(side="left", fill="y")
        self.sidebar.pack_propagate(False)

        ctk.CTkLabel(self.sidebar, text="Finance\nDashboard",
                     font=FONT_TITLE, text_color=COLORS["accent"],
                     justify="center").pack(pady=(30, 10), padx=10)

        muted_label(self.sidebar, "Personal Finance Tracker").pack(pady=(0, 30))

        self.nav_buttons = {}
        nav_items = [
            ("📊  Overview",    "overview"),
            ("💵  Paychecks",   "paychecks"),
            ("📈  Investments", "investments"),
            ("🧾  Spending",    "spending"),
            ("🔄  Subscriptions", "subscriptions"),
            ("📅  History",     "history"),
        ]
        self.active_tab = "overview"
        for label, key in nav_items:
            btn = ctk.CTkButton(
                self.sidebar, text=label, anchor="w",
                font=FONT_BODY, height=42, corner_radius=8,
                fg_color=COLORS["accent"] if key == self.active_tab else "transparent",
                hover_color=COLORS["border"],
                text_color=COLORS["text"],
                command=lambda k=key: self._switch_tab(k)
            )
            btn.pack(fill="x", padx=12, pady=3)
            self.nav_buttons[key] = btn

        # Content area
        self.content = ctk.CTkFrame(self, fg_color=COLORS["bg"], corner_radius=0)
        self.content.pack(side="left", fill="both", expand=True)

        self.tabs = {}
        for _, key in nav_items:
            frame = ctk.CTkScrollableFrame(self.content, fg_color=COLORS["bg"],
                                           corner_radius=0,
                                           scrollbar_button_color=COLORS["border"])
            self.tabs[key] = frame
            self._bind_mousewheel(frame)

        self._build_overview()
        self._build_paychecks()
        self._build_investments()
        self._build_spending()
        self._build_subscriptions()
        self._build_history()

        self._switch_tab("overview")

    def _bind_mousewheel(self, frame):
        """Enable mouse wheel scrolling on a scrollable frame."""
        def _on_mousewheel(event):
            # Normalize scroll direction across platforms
            if event.num == 5 or event.delta < 0:
                frame._parent_canvas.yview_scroll(3, "units")
            elif event.num == 4 or event.delta > 0:
                frame._parent_canvas.yview_scroll(-3, "units")
        
        # Bind to the frame and its children
        frame.bind("<MouseWheel>", _on_mousewheel, add="+")
        frame.bind("<Button-4>", _on_mousewheel, add="+")
        frame.bind("<Button-5>", _on_mousewheel, add="+")

    def _switch_tab(self, key):
        for k, frame in self.tabs.items():
            frame.pack_forget()
        for k, btn in self.nav_buttons.items():
            btn.configure(fg_color=COLORS["accent"] if k == key else "transparent")
        self.active_tab = key
        self.tabs[key].pack(fill="both", expand=True)
        # Refresh overview whenever we visit it
        if key == "overview":
            self._refresh_overview()

    # ── Overview ───────────────────────────────────────────────────────────────
    def _build_overview(self):
        f = self.tabs["overview"]
        ctk.CTkLabel(f, text="Overview", font=FONT_TITLE,
                     text_color=COLORS["text"]).pack(anchor="w", padx=30, pady=(30, 5))
        muted_label(f, f"Last updated: {date.today().strftime('%B %d, %Y')}").pack(
            anchor="w", padx=30, pady=(0, 20))

        self.ov_cards_frame = ctk.CTkFrame(f, fg_color="transparent")
        self.ov_cards_frame.pack(fill="x", padx=30)

        self.ov_chart_frame = ctk.CTkFrame(f, fg_color="transparent")
        self.ov_chart_frame.pack(fill="x", padx=30, pady=20)

        self.ov_breakdown = ctk.CTkFrame(f, fg_color="transparent")
        self.ov_breakdown.pack(fill="x", padx=30, pady=(0, 20))
        
        # Breakdown content frame (will be refreshed dynamically)
        self.ov_breakdown_content = ctk.CTkFrame(self.ov_breakdown, fg_color="transparent")
        self.ov_breakdown_content.pack(fill="x")

        # Budget sliders section
        self.slider_card = card_frame(f)
        self.slider_card.pack(fill="x", padx=30, pady=(0, 20))

        ctk.CTkLabel(self.slider_card, text="Budget Allocation", font=FONT_HEAD,
                     text_color=COLORS["text"]).pack(anchor="w", padx=16, pady=(14, 8))

        self.slider_vals = {
            "needs":   ctk.IntVar(value=self.data["budget_sliders"]["needs"]),
            "wants":   ctk.IntVar(value=self.data["budget_sliders"]["wants"]),
            "savings": ctk.IntVar(value=self.data["budget_sliders"]["savings"]),
        }
        self.slider_widgets = {}
        self.slider_labels  = {}

        config = [
            ("needs",   "🏠  Needs",   COLORS["accent"],  "Rent, food, utilities, transport"),
            ("wants",   "🎮  Wants",   COLORS["accent4"], "Entertainment, dining out, hobbies"),
            ("savings", "💰  Savings", COLORS["accent2"], "Investments, emergency fund, retirement"),
        ]

        for key, label, color, desc in config:
            row = ctk.CTkFrame(self.slider_card, fg_color="transparent")
            row.pack(fill="x", padx=20, pady=12)

            info = ctk.CTkFrame(row, fg_color="transparent")
            info.pack(side="left", fill="x", expand=True)
            ctk.CTkLabel(info, text=label, font=FONT_HEAD,
                         text_color=color).pack(anchor="w")
            muted_label(info, desc).pack(anchor="w")

            pct_lbl = ctk.CTkLabel(row, text=f"{self.slider_vals[key].get()}%",
                                   font=FONT_NUM, text_color=color, width=60)
            pct_lbl.pack(side="right", padx=12)
            self.slider_labels[key] = pct_lbl

            sl = ctk.CTkSlider(self.slider_card, from_=0, to=100, number_of_steps=100,
                               variable=self.slider_vals[key],
                               progress_color=color, button_color=color,
                               button_hover_color=color,
                               command=lambda v, k=key: self._slider_changed(k))
            sl.pack(fill="x", padx=20, pady=(0, 8))
            self.slider_widgets[key] = sl

        # Total indicator
        self.total_label = ctk.CTkLabel(self.slider_card, text="Total: 100%",
                                        font=FONT_HEAD, text_color=COLORS["accent2"])
        self.total_label.pack(pady=(8, 16))

        ctk.CTkButton(self.slider_card, text="Save Allocation", fg_color=COLORS["accent"],
                      hover_color="#3a7be0", font=FONT_BODY,
                      command=self._save_sliders).pack(padx=20, pady=(0, 16))
        
        # allow user to save data as excel
        ctk.CTkButton(self.slider_card, text="Export Data to Excel", fg_color=COLORS["accent4"],
                      hover_color="#fbbf24", font=FONT_BODY,
                      command=lambda: export_to_excel(self.data)).pack(padx=20, pady=(0, 16))

        # allow user to import an excel file of expenses
        # ctk.CTkButton(self.slider_card, text="Import Expenses from Excel", fg_color=COLORS["accent4"],

        self._refresh_overview()

    def _refresh_overview(self):
        for w in self.ov_cards_frame.winfo_children():
            w.destroy()
        for w in self.ov_chart_frame.winfo_children():
            w.destroy()
        for w in self.ov_breakdown.winfo_children():
            w.destroy()

        d = self.data
        monthly_income = sum(self._monthly_amount(p) for p in d["paychecks"])
        total_investments = sum(parse_amount(i.get("value", 0)) for i in d["investments"])
        monthly_spending = sum(parse_amount(s.get("amount", 0)) for s in d["spending"]
                               if self._this_month(s.get("date", "")))
        monthly_subscriptions = sum(parse_amount(s.get("amount", 0)) for s in d["subscriptions"]
                                    if s.get("active", True))
        total_monthly_expenses = monthly_spending + monthly_subscriptions
        net = monthly_income - total_monthly_expenses

        cards = [
            ("Monthly Income",    fmt_money(monthly_income), COLORS["accent2"]),
            ("Monthly Spending",  fmt_money(monthly_spending), COLORS["accent3"]),
            ("Subscriptions",     fmt_money(monthly_subscriptions), COLORS["accent4"]),
            ("Net Cash Flow",     fmt_money(net), COLORS["accent"] if net >= 0 else COLORS["accent3"]),
        ]
        for i, (title, val, color) in enumerate(cards):
            c = card_frame(self.ov_cards_frame)
            c.grid(row=0, column=i, padx=8, pady=5, sticky="ew")
            self.ov_cards_frame.columnconfigure(i, weight=1)
            muted_label(c, title).pack(anchor="w", padx=16, pady=(14, 2))
            ctk.CTkLabel(c, text=val, font=FONT_NUM,
                         text_color=color).pack(anchor="w", padx=16, pady=(0, 14))

        # Spending by category chart
        cat_totals = {}
        for s in d["spending"]:
            cat = s.get("category", "Other")
            cat_totals[cat] = cat_totals.get(cat, 0) + parse_amount(s.get("amount", 0))

        if cat_totals:
            fig = Figure(figsize=(5, 2.8), dpi=96,
                         facecolor=COLORS["card"])
            ax = fig.add_subplot(111)
            ax.set_facecolor(COLORS["card"])
            cats = list(cat_totals.keys())
            vals = [cat_totals[c] for c in cats]
            palette = ["#4f8ef7", "#34d399", "#f87171", "#fbbf24",
                       "#a78bfa", "#fb7185", "#38bdf8", "#86efac"]
            bars = ax.barh(cats, vals,
                           color=palette[:len(cats)], height=0.55)
            ax.set_xlabel("Amount ($)", color=COLORS["muted"], fontsize=9)
            ax.tick_params(colors=COLORS["muted"], labelsize=9)
            for spine in ax.spines.values():
                spine.set_edgecolor(COLORS["border"])
            fig.tight_layout(pad=1.2)

            lbl = ctk.CTkLabel(self.ov_chart_frame,
                               text="Spending by Category",
                               font=FONT_HEAD, text_color=COLORS["text"])
            lbl.pack(anchor="w", pady=(0, 6))
            canvas = FigureCanvasTkAgg(fig, master=self.ov_chart_frame)
            canvas.draw()
            canvas.get_tk_widget().configure(bg=COLORS["card"],
                                             highlightthickness=0)
            canvas.get_tk_widget().pack(fill="x")

        # Refresh budget breakdown dynamically
        self._refresh_budget_breakdown()

    def _monthly_amount(self, p):
        freq = p.get("frequency", "monthly")
        amt = parse_amount(p.get("amount", 0))
        return {
            "weekly":      amt * 52 / 12,
            "biweekly":    amt * 26 / 12,
            "semimonthly": amt * 2,
            "monthly":     amt,
            "quarterly":   amt / 3,
            "annually":    amt / 12,
        }.get(freq, amt)

    def _this_month(self, date_str):
        try:
            d = datetime.strptime(date_str, "%Y-%m-%d")
            today = date.today()
            return d.year == today.year and d.month == today.month
        except Exception:
            return False

    # ── Paychecks ──────────────────────────────────────────────────────────────
    def _build_paychecks(self):
        f = self.tabs["paychecks"]
        header = ctk.CTkFrame(f, fg_color="transparent")
        header.pack(fill="x", padx=30, pady=(30, 0))
        ctk.CTkLabel(header, text="Paychecks", font=FONT_TITLE,
                     text_color=COLORS["text"]).pack(side="left")
        ctk.CTkButton(header, text="+ Add Paycheck", font=FONT_BODY,
                      fg_color=COLORS["accent"], hover_color="#3a7be0",
                      command=self._add_paycheck_dialog).pack(side="right")

        muted_label(f, "Manage your recurring income sources").pack(
            anchor="w", padx=30, pady=(4, 20))

        self.paycheck_list = ctk.CTkFrame(f, fg_color="transparent")
        self.paycheck_list.pack(fill="x", padx=30, pady=(0, 30))
        self._refresh_paychecks()

    def _refresh_paychecks(self):
        for w in self.paycheck_list.winfo_children():
            w.destroy()
        if not self.data["paychecks"]:
            muted_label(self.paycheck_list,
                        "No paychecks yet. Click '+ Add Paycheck' to get started.").pack(
                pady=20)
            return
        for p in self.data["paychecks"]:
            self._paycheck_card(p)

    def _paycheck_card(self, p):
        c = card_frame(self.paycheck_list)
        c.pack(fill="x", pady=6)
        row = ctk.CTkFrame(c, fg_color="transparent")
        row.pack(fill="x", padx=16, pady=12)

        left = ctk.CTkFrame(row, fg_color="transparent")
        left.pack(side="left", fill="x", expand=True)
        ctk.CTkLabel(left, text=p.get("name", "Paycheck"), font=FONT_HEAD,
                     text_color=COLORS["text"]).pack(anchor="w")
        muted_label(left, f"{p.get('frequency','monthly').capitalize()} · Next: {p.get('next_date','—')}").pack(
            anchor="w")
        if p.get("notes"):
            muted_label(left, p["notes"]).pack(anchor="w")

        right = ctk.CTkFrame(row, fg_color="transparent")
        right.pack(side="right")
        ctk.CTkLabel(right, text=fmt_money(p.get("amount", 0)),
                     font=FONT_NUM, text_color=COLORS["accent2"]).pack(anchor="e")
        monthly = self._monthly_amount(p)
        muted_label(right, f"{fmt_money(monthly)}/mo").pack(anchor="e")

        btn_row = ctk.CTkFrame(c, fg_color="transparent")
        btn_row.pack(anchor="e", padx=16, pady=(0, 10))
        ctk.CTkButton(btn_row, text="Edit", width=70, height=28,
                      font=FONT_SMALL, fg_color=COLORS["border"],
                      hover_color=COLORS["accent"],
                      command=lambda: self._edit_paycheck_dialog(p)).pack(side="left", padx=4)
        ctk.CTkButton(btn_row, text="Delete", width=70, height=28,
                      font=FONT_SMALL, fg_color=COLORS["border"],
                      hover_color=COLORS["accent3"],
                      command=lambda: self._delete_item("paychecks", p["id"],
                                                        self._refresh_paychecks)).pack(side="left", padx=4)

    def _add_paycheck_dialog(self):
        self._paycheck_dialog(None)

    def _edit_paycheck_dialog(self, p):
        self._paycheck_dialog(p)

    def _paycheck_dialog(self, existing):
        dlg = ctk.CTkToplevel(self)
        dlg.title("Add Paycheck" if not existing else "Edit Paycheck")
        dlg.geometry("420x420")
        dlg.configure(fg_color=COLORS["surface"])
        dlg.grab_set()

        ctk.CTkLabel(dlg, text="Paycheck Details", font=FONT_HEAD,
                     text_color=COLORS["accent"]).pack(pady=(20, 10))

        fields = {}
        for label, key, default in [
            ("Name / Employer", "name", ""),
            ("Amount (per paycheck)", "amount", ""),
            ("Next Pay Date (YYYY-MM-DD)", "next_date", str(date.today())),
            ("Notes (optional)", "notes", ""),
        ]:
            ctk.CTkLabel(dlg, text=label, font=FONT_SMALL,
                         text_color=COLORS["muted"]).pack(anchor="w", padx=24)
            e = ctk.CTkEntry(dlg, font=FONT_BODY, fg_color=COLORS["card"],
                             border_color=COLORS["border"])
            e.pack(fill="x", padx=24, pady=(2, 8))
            e.insert(0, existing.get(key, default) if existing else default)
            fields[key] = e

        ctk.CTkLabel(dlg, text="Frequency", font=FONT_SMALL,
                     text_color=COLORS["muted"]).pack(anchor="w", padx=24)
        freq_var = ctk.StringVar(value=existing.get("frequency", "biweekly") if existing else "biweekly")
        freq_menu = ctk.CTkOptionMenu(dlg, variable=freq_var,
                                      values=["weekly", "biweekly", "semimonthly",
                                              "monthly", "quarterly", "annually"],
                                      fg_color=COLORS["card"],
                                      button_color=COLORS["accent"])
        freq_menu.pack(fill="x", padx=24, pady=(2, 16))

        def save():
            rec = {
                "id":        existing["id"] if existing else make_id(),
                "name":      fields["name"].get().strip() or "Paycheck",
                "amount":    fields["amount"].get().strip() or "0",
                "frequency": freq_var.get(),
                "next_date": fields["next_date"].get().strip(),
                "notes":     fields["notes"].get().strip(),
            }
            if existing:
                idx = next(i for i, x in enumerate(self.data["paychecks"])
                           if x["id"] == existing["id"])
                self.data["paychecks"][idx] = rec
            else:
                self.data["paychecks"].append(rec)
            save_data(self.data)
            self._refresh_paychecks()
            dlg.destroy()

        ctk.CTkButton(dlg, text="Save", fg_color=COLORS["accent"],
                      hover_color="#3a7be0", font=FONT_BODY,
                      command=save).pack(fill="x", padx=24)

    # ── Investments ────────────────────────────────────────────────────────────
    def _build_investments(self):
        f = self.tabs["investments"]
        header = ctk.CTkFrame(f, fg_color="transparent")
        header.pack(fill="x", padx=30, pady=(30, 0))
        ctk.CTkLabel(header, text="Investments", font=FONT_TITLE,
                     text_color=COLORS["text"]).pack(side="left")
        ctk.CTkButton(header, text="+ Add Investment", font=FONT_BODY,
                      fg_color=COLORS["accent4"], hover_color="#d97706",
                      text_color=COLORS["bg"],
                      command=self._add_investment_dialog).pack(side="right")

        muted_label(f, "Track your portfolio and monthly contributions").pack(
            anchor="w", padx=30, pady=(4, 20))

        self.inv_summary = ctk.CTkFrame(f, fg_color="transparent")
        self.inv_summary.pack(fill="x", padx=30)
        self.inv_list = ctk.CTkFrame(f, fg_color="transparent")
        self.inv_list.pack(fill="x", padx=30, pady=(0, 30))
        self._refresh_investments()

    def _refresh_investments(self):
        for w in self.inv_summary.winfo_children():
            w.destroy()
        for w in self.inv_list.winfo_children():
            w.destroy()

        invs = self.data["investments"]
        total_val = sum(parse_amount(i.get("value", 0)) for i in invs)
        total_contrib = sum(parse_amount(i.get("monthly_contribution", 0)) for i in invs)

        s = card_frame(self.inv_summary)
        s.pack(fill="x", pady=(0, 16))
        row = ctk.CTkFrame(s, fg_color="transparent")
        row.pack(fill="x", padx=16, pady=14)
        for title, val, color in [
            ("Total Portfolio Value", fmt_money(total_val), COLORS["accent4"]),
            ("Monthly Contributions", fmt_money(total_contrib), COLORS["accent2"]),
            ("# of Holdings", str(len(invs)), COLORS["accent"]),
        ]:
            col = ctk.CTkFrame(row, fg_color="transparent")
            col.pack(side="left", expand=True)
            muted_label(col, title).pack()
            ctk.CTkLabel(col, text=val, font=FONT_NUM,
                         text_color=color).pack()

        if not invs:
            muted_label(self.inv_list,
                        "No investments yet. Click '+ Add Investment'.").pack(pady=20)
            return

        for inv in invs:
            self._investment_card(inv)

    def _investment_card(self, inv):
        c = card_frame(self.inv_list)
        c.pack(fill="x", pady=6)
        row = ctk.CTkFrame(c, fg_color="transparent")
        row.pack(fill="x", padx=16, pady=12)

        left = ctk.CTkFrame(row, fg_color="transparent")
        left.pack(side="left", fill="x", expand=True)
        ctk.CTkLabel(left, text=inv.get("name", "Investment"), font=FONT_HEAD,
                     text_color=COLORS["text"]).pack(anchor="w")
        muted_label(left, f"Type: {inv.get('type', '—')}").pack(anchor="w")
        if inv.get("notes"):
            muted_label(left, inv["notes"]).pack(anchor="w")

        right = ctk.CTkFrame(row, fg_color="transparent")
        right.pack(side="right")
        
        # Make value clickable for quick edit
        val_btn = ctk.CTkButton(
            right, text=fmt_money(inv.get("value", 0)),
            font=FONT_NUM, text_color=COLORS["accent4"],
            fg_color="transparent", hover_color=COLORS["card"],
            height=30, border_width=1, border_color=COLORS["border"],
            command=lambda: self._quick_edit_investment(inv, "value")
        )
        val_btn.pack(anchor="e", pady=2)
        
        # Make monthly contribution clickable for quick edit
        contrib_btn = ctk.CTkButton(
            right, text=f"+{fmt_money(inv.get('monthly_contribution', 0))}/mo",
            font=FONT_SMALL, text_color=COLORS["muted"],
            fg_color="transparent", hover_color=COLORS["card"],
            height=24, border_width=1, border_color=COLORS["border"],
            command=lambda: self._quick_edit_investment(inv, "monthly_contribution")
        )
        contrib_btn.pack(anchor="e", pady=2)

        btn_row = ctk.CTkFrame(c, fg_color="transparent")
        btn_row.pack(anchor="e", padx=16, pady=(0, 10))
        ctk.CTkButton(btn_row, text="Edit", width=70, height=28,
                      font=FONT_SMALL, fg_color=COLORS["border"],
                      hover_color=COLORS["accent"],
                      command=lambda: self._investment_dialog(inv)).pack(
            side="left", padx=4)
        ctk.CTkButton(btn_row, text="Delete", width=70, height=28,
                      font=FONT_SMALL, fg_color=COLORS["border"],
                      hover_color=COLORS["accent3"],
                      command=lambda: self._delete_item("investments", inv["id"],
                                                        self._refresh_investments)).pack(
            side="left", padx=4)

    def _quick_edit_investment(self, inv, field):
        """Quick edit for investment value or monthly contribution."""
        dlg = ctk.CTkToplevel(self)
        dlg.title(f"Edit {inv.get('name', 'Investment')}")
        dlg.geometry("300x180")
        dlg.configure(fg_color=COLORS["surface"])
        dlg.grab_set()

        label_text = "Current Value ($)" if field == "value" else "Monthly Contribution ($)"
        ctk.CTkLabel(dlg, text=inv.get("name", "Investment"), font=FONT_HEAD,
                     text_color=COLORS["accent4"]).pack(pady=(20, 10))
        ctk.CTkLabel(dlg, text=label_text, font=FONT_SMALL,
                     text_color=COLORS["muted"]).pack(anchor="w", padx=24)
        
        entry = ctk.CTkEntry(dlg, font=FONT_BODY, fg_color=COLORS["card"],
                             border_color=COLORS["border"])
        entry.pack(fill="x", padx=24, pady=(2, 16))
        entry.insert(0, str(inv.get(field, "0")))
        entry.select_range(0, "end")
        entry.focus()

        def save():
            inv[field] = entry.get().strip() or "0"
            save_data(self.data)
            self._refresh_investments()
            self._refresh_overview()
            dlg.destroy()

        ctk.CTkButton(dlg, text="Save", fg_color=COLORS["accent4"],
                      hover_color="#d97706", text_color=COLORS["bg"],
                      font=FONT_BODY, command=save).pack(fill="x", padx=24)
        
        # Allow Enter to save
        entry.bind("<Return>", lambda e: save())

    def _add_investment_dialog(self):
        self._investment_dialog(None)

    def _investment_dialog(self, existing):
        dlg = ctk.CTkToplevel(self)
        dlg.title("Add Investment" if not existing else "Edit Investment")
        dlg.geometry("420x420")
        dlg.configure(fg_color=COLORS["surface"])
        dlg.grab_set()

        ctk.CTkLabel(dlg, text="Investment Details", font=FONT_HEAD,
                     text_color=COLORS["accent4"]).pack(pady=(20, 10))

        fields = {}
        for label, key, default in [
            ("Name (e.g. Fidelity 401k)", "name", ""),
            ("Current Value ($)", "value", "0"),
            ("Monthly Contribution ($)", "monthly_contribution", "0"),
            ("Notes (optional)", "notes", ""),
        ]:
            ctk.CTkLabel(dlg, text=label, font=FONT_SMALL,
                         text_color=COLORS["muted"]).pack(anchor="w", padx=24)
            e = ctk.CTkEntry(dlg, font=FONT_BODY, fg_color=COLORS["card"],
                             border_color=COLORS["border"])
            e.pack(fill="x", padx=24, pady=(2, 8))
            e.insert(0, existing.get(key, default) if existing else default)
            fields[key] = e

        ctk.CTkLabel(dlg, text="Type", font=FONT_SMALL,
                     text_color=COLORS["muted"]).pack(anchor="w", padx=24)
        type_var = ctk.StringVar(value=existing.get("type", "401(k)") if existing else "401(k)")
        ctk.CTkOptionMenu(dlg, variable=type_var,
                          values=["401(k)", "Roth IRA", "Traditional IRA", "Brokerage",
                                  "HSA", "529", "Crypto", "Real Estate", "Other"],
                          fg_color=COLORS["card"],
                          button_color=COLORS["accent4"]).pack(
            fill="x", padx=24, pady=(2, 16))

        def save():
            rec = {
                "id":                   existing["id"] if existing else make_id(),
                "name":                 fields["name"].get().strip() or "Investment",
                "type":                 type_var.get(),
                "value":                fields["value"].get().strip() or "0",
                "monthly_contribution": fields["monthly_contribution"].get().strip() or "0",
                "notes":                fields["notes"].get().strip(),
            }
            if existing:
                idx = next(i for i, x in enumerate(self.data["investments"])
                           if x["id"] == existing["id"])
                self.data["investments"][idx] = rec
            else:
                self.data["investments"].append(rec)
            save_data(self.data)
            self._refresh_investments()
            self._refresh_overview()
            dlg.destroy()

        ctk.CTkButton(dlg, text="Save", fg_color=COLORS["accent4"],
                      hover_color="#d97706", text_color=COLORS["bg"],
                      font=FONT_BODY, command=save).pack(fill="x", padx=24)

    # ── Spending ───────────────────────────────────────────────────────────────
    def _build_spending(self):
        f = self.tabs["spending"]
        header = ctk.CTkFrame(f, fg_color="transparent")
        header.pack(fill="x", padx=30, pady=(30, 0))
        ctk.CTkLabel(header, text="Spending", font=FONT_TITLE,
                     text_color=COLORS["text"]).pack(side="left")
        ctk.CTkButton(header, text="+ Log Expense", font=FONT_BODY,
                      fg_color=COLORS["accent3"], hover_color="#dc2626",
                      command=self._add_spending_dialog).pack(side="right")

        muted_label(f, "Track where your money is going").pack(
            anchor="w", padx=30, pady=(4, 20))

        self.spend_summary = ctk.CTkFrame(f, fg_color="transparent")
        self.spend_summary.pack(fill="x", padx=30)
        self.spend_list = ctk.CTkFrame(f, fg_color="transparent")
        self.spend_list.pack(fill="x", padx=30, pady=(0, 30))
        self._refresh_spending()

    def _refresh_spending(self):
        for w in self.spend_summary.winfo_children():
            w.destroy()
        for w in self.spend_list.winfo_children():
            w.destroy()

        entries = self.data["spending"]
        this_month = [s for s in entries if self._this_month(s.get("date", ""))]
        total_this_month = sum(parse_amount(s.get("amount", 0)) for s in this_month)
        total_all = sum(parse_amount(s.get("amount", 0)) for s in entries)

        s = card_frame(self.spend_summary)
        s.pack(fill="x", pady=(0, 16))
        row = ctk.CTkFrame(s, fg_color="transparent")
        row.pack(fill="x", padx=16, pady=14)
        for title, val, color in [
            ("This Month", fmt_money(total_this_month), COLORS["accent3"]),
            ("All Time",   fmt_money(total_all),        COLORS["muted"]),
            ("# Entries",  str(len(entries)),            COLORS["accent"]),
        ]:
            col = ctk.CTkFrame(row, fg_color="transparent")
            col.pack(side="left", expand=True)
            muted_label(col, title).pack()
            ctk.CTkLabel(col, text=val, font=FONT_NUM,
                         text_color=color).pack()

        if not entries:
            muted_label(self.spend_list,
                        "No expenses logged yet.").pack(pady=20)
            return

        # Sort newest first
        sorted_entries = sorted(entries,
                                key=lambda x: x.get("date", ""),
                                reverse=True)
        for s in sorted_entries[:50]:  # show up to 50
            self._spending_card(s)

    def _spending_card(self, s):
        c = card_frame(self.spend_list)
        c.pack(fill="x", pady=4)
        row = ctk.CTkFrame(c, fg_color="transparent")
        row.pack(fill="x", padx=16, pady=10)

        left = ctk.CTkFrame(row, fg_color="transparent")
        left.pack(side="left", fill="x", expand=True)

        cat_colors = {
            "Food": "#34d399", "Gas": "#fbbf24", "Utilities": "#60a5fa",
            "Drinking": "#f87171", "Entertainment": "#a78bfa",
            "Healthcare": "#fb7185", "Clothing": "#38bdf8", "Drinks": "#a855f7",
            "Other": "#9ca3af", "Alcohol": "#ec4899"
        }
        cat = s.get("category", "Other")
        dot_color = cat_colors.get(cat, COLORS["muted"])

        # Category label with combined expense indicator
        cat_label = f"● {cat}"
        if s.get("combined", False):
            item_count = s.get("item_count", 1)
            cat_label += f"  ({item_count} items)"
        
        ctk.CTkLabel(left,
                     text=cat_label,
                     font=FONT_BODY, text_color=dot_color).pack(anchor="w")
        muted_label(left, s.get("date", "—") + ("  ·  " + s["notes"] if s.get("notes") else "")).pack(
            anchor="w")

        ctk.CTkLabel(row, text=fmt_money(s.get("amount", 0)),
                     font=FONT_HEAD, text_color=COLORS["accent3"]).pack(side="right", padx=8)
        
        ctk.CTkButton(row, text="Edit", width=50, height=28,
                      font=FONT_SMALL, fg_color=COLORS["border"],
                      hover_color=COLORS["accent"],
                      command=lambda: self._spending_dialog(s)).pack(side="right", padx=2)
        
        ctk.CTkButton(row, text="✕", width=28, height=28,
                      font=FONT_SMALL, fg_color=COLORS["border"],
                      hover_color=COLORS["accent3"],
                      command=lambda: self._delete_item("spending", s["id"],
                                                        self._refresh_spending)).pack(side="right", padx=2)

    def _add_spending_dialog(self):
        self._spending_dialog(None)

    def _spending_dialog(self, existing):
        dlg = ctk.CTkToplevel(self)
        dlg.title("Edit Expense" if existing else "Log Expense")
        dlg.geometry("420x520")
        dlg.configure(fg_color=COLORS["surface"])
        dlg.grab_set()

        ctk.CTkLabel(dlg, text="Expense Details", font=FONT_HEAD,
                     text_color=COLORS["accent3"]).pack(pady=(20, 10))

        ctk.CTkLabel(dlg, text="Category", font=FONT_SMALL,
                     text_color=COLORS["muted"]).pack(anchor="w", padx=24)
        cat_var = ctk.StringVar(value=existing.get("category", "Food") if existing else "Food")
        # Use hardcoded categories with fallback
        categories = self.data.get("spending_categories", []) or ["Food", "Gas", "Transit/Parking", "Entertainment", "Clothing", "Drinks", "Other", "Alcohol"]
        ctk.CTkOptionMenu(dlg, variable=cat_var,
                          values=categories,
                          fg_color=COLORS["card"],
                          button_color=COLORS["accent3"]).pack(
            fill="x", padx=24, pady=(2, 8))

        fields = {}
        for label, key, default in [
            ("Amount ($)", "amount", ""),
            ("Date (YYYY-MM-DD)", "date", str(date.today())),
            ("Notes (optional)", "notes", ""),
        ]:
            ctk.CTkLabel(dlg, text=label, font=FONT_SMALL,
                         text_color=COLORS["muted"]).pack(anchor="w", padx=24)
            e = ctk.CTkEntry(dlg, font=FONT_BODY, fg_color=COLORS["card"],
                             border_color=COLORS["border"])
            e.pack(fill="x", padx=24, pady=(2, 8))
            if existing:
                e.insert(0, existing.get(key, default))
            else:
                e.insert(0, default)
            fields[key] = e

        # Combined expense toggle
        combined_var = ctk.BooleanVar(value=existing.get("combined", False) if existing else False)
        ctk.CTkCheckBox(dlg, text="Combined expense (multiple items)", 
                        variable=combined_var, font=FONT_BODY,
                        checkbox_width=20, checkbox_height=20,
                        fg_color=COLORS["accent3"]).pack(anchor="w", padx=24, pady=(8, 8))

        # Item count field (shown only when combined is checked)
        count_label = ctk.CTkLabel(dlg, text="Number of items", font=FONT_SMALL,
                                   text_color=COLORS["muted"])
        count_entry = ctk.CTkEntry(dlg, font=FONT_BODY, fg_color=COLORS["card"],
                                   border_color=COLORS["border"])
        count_entry.insert(0, str(existing.get("item_count", 1)) if existing else "1")

        def toggle_combined(val):
            if combined_var.get():
                count_label.pack(anchor="w", padx=24, pady=(0, 2))
                count_entry.pack(fill="x", padx=24, pady=(2, 8))
            else:
                count_label.pack_forget()
                count_entry.pack_forget()

        combined_var.trace_add("write", lambda *args: toggle_combined(None))
        
        # Show/hide count field based on initial state
        if existing and existing.get("combined", False):
            toggle_combined(None)

        def save():
            rec = {
                "id":       existing["id"] if existing else make_id(),
                "category": cat_var.get(),
                "amount":   fields["amount"].get().strip() or "0",
                "date":     fields["date"].get().strip() or str(date.today()),
                "notes":    fields["notes"].get().strip(),
                "combined": combined_var.get(),
                "item_count": int(count_entry.get().strip() or "1") if combined_var.get() else 1,
            }
            if existing:
                idx = next(i for i, x in enumerate(self.data["spending"])
                           if x["id"] == existing["id"])
                self.data["spending"][idx] = rec
            else:
                self.data["spending"].append(rec)
            save_data(self.data)
            self._refresh_spending()
            self._refresh_overview()
            dlg.destroy()

        ctk.CTkButton(dlg, text="Save", fg_color=COLORS["accent3"],
                      hover_color="#dc2626", font=FONT_BODY,
                      command=save).pack(fill="x", padx=24, pady=(8, 0))

    # ── Subscriptions ──────────────────────────────────────────────────────────
    def _build_subscriptions(self):
        f = self.tabs["subscriptions"]
        header = ctk.CTkFrame(f, fg_color="transparent")
        header.pack(fill="x", padx=30, pady=(30, 0))
        ctk.CTkLabel(header, text="Subscriptions", font=FONT_TITLE,
                     text_color=COLORS["text"]).pack(side="left")
        ctk.CTkButton(header, text="+ Add Subscription", font=FONT_BODY,
                      fg_color=COLORS["accent2"], hover_color="#10b981",
                      command=self._add_subscription_dialog).pack(side="right")

        muted_label(f, "Track your recurring monthly subscriptions").pack(
            anchor="w", padx=30, pady=(4, 20))

        self.sub_summary = ctk.CTkFrame(f, fg_color="transparent")
        self.sub_summary.pack(fill="x", padx=30)
        self.sub_list = ctk.CTkFrame(f, fg_color="transparent")
        self.sub_list.pack(fill="x", padx=30, pady=(0, 30))
        self._refresh_subscriptions()

    def _refresh_subscriptions(self):
        for w in self.sub_summary.winfo_children():
            w.destroy()
        for w in self.sub_list.winfo_children():
            w.destroy()

        subs = self.data["subscriptions"]
        
        # Calculate totals by category
        sub_totals = {}
        for sub in subs:
            if sub.get("active", True):
                cat = sub.get("category", "Other")
                sub_totals[cat] = sub_totals.get(cat, 0) + parse_amount(sub.get("amount", 0))
        
        total_subs = sum(sub_totals.values())

        # Summary card
        s = card_frame(self.sub_summary)
        s.pack(fill="x", pady=(0, 16))
        row = ctk.CTkFrame(s, fg_color="transparent")
        row.pack(fill="x", padx=16, pady=14)
        
        for title, val, color in [
            ("Total Monthly", fmt_money(total_subs), COLORS["accent4"]),
            ("# Active", str(len([x for x in subs if x.get("active", True)])), COLORS["accent"]),
            ("# Subscriptions", str(len(subs)), COLORS["accent2"]),
        ]:
            col = ctk.CTkFrame(row, fg_color="transparent")
            col.pack(side="left", expand=True)
            muted_label(col, title).pack()
            ctk.CTkLabel(col, text=val, font=FONT_NUM,
                         text_color=color).pack()

        # Subscriptions list
        if not subs:
            muted_label(self.sub_list, "No subscriptions yet. Add one to get started!").pack(pady=20)
            return

        for sub in subs:
            item = card_frame(self.sub_list)
            item.pack(fill="x", pady=6)

            row = ctk.CTkFrame(item, fg_color="transparent")
            row.pack(fill="x", padx=16, pady=12)

            # Left side: name and category
            left = ctk.CTkFrame(row, fg_color="transparent")
            left.pack(side="left", fill="x", expand=True)
            
            body_label(left, sub.get("name", "Untitled")).pack(anchor="w")
            cat = sub.get("category", "Other")
            cat_color = COLORS["accent"] if cat == "Gym" else COLORS["accent4"]
            muted_label(left, cat).pack(anchor="w")

            # Right side: amount and status
            right = ctk.CTkFrame(row, fg_color="transparent")
            right.pack(side="right", padx=(16, 0))
            
            amt_color = COLORS["accent2"] if sub.get("active", True) else COLORS["muted"]
            ctk.CTkLabel(right, text=fmt_money(sub.get("amount", 0)), 
                         font=FONT_NUM, text_color=amt_color).pack()
            
            status = "Active" if sub.get("active", True) else "Inactive"
            status_color = COLORS["accent2"] if sub.get("active", True) else COLORS["muted"]
            muted_label(right, status).pack()

            # Action buttons row
            btn_row = ctk.CTkFrame(item, fg_color="transparent")
            btn_row.pack(fill="x", padx=16, pady=(0, 12))

            ctk.CTkButton(btn_row, text="Edit", width=60, height=28,
                          font=FONT_SMALL, fg_color=COLORS["border"],
                          hover_color=COLORS["accent"],
                          command=lambda s=sub: self._add_subscription_dialog(s)).pack(side="left", padx=2)
            
            ctk.CTkButton(btn_row, text="Delete", width=60, height=28,
                          font=FONT_SMALL, fg_color=COLORS["accent3"],
                          hover_color="#dc2626",
                          command=lambda sid=sub["id"]: self._delete_subscription(sid)).pack(side="left", padx=2)

    def _delete_subscription(self, sub_id):
        self.data["subscriptions"] = [s for s in self.data["subscriptions"] if s["id"] != sub_id]
        save_data(self.data)
        self._refresh_subscriptions()

    def _add_subscription_dialog(self, existing=None):
        dlg = ctk.CTkToplevel(self)
        dlg.title("Add Subscription" if not existing else "Edit Subscription")
        dlg.geometry("420x450")
        dlg.configure(fg_color=COLORS["surface"])
        dlg.grab_set()

        ctk.CTkLabel(dlg, text="Subscription Details", font=FONT_HEAD,
                     text_color=COLORS["accent2"]).pack(pady=(20, 10))

        fields = {}
        for label, key, default in [
            ("Service Name (e.g. Spotify)", "name", ""),
            ("Monthly Cost ($)", "amount", "0"),
            ("Notes (optional)", "notes", ""),
        ]:
            ctk.CTkLabel(dlg, text=label, font=FONT_SMALL,
                         text_color=COLORS["muted"]).pack(anchor="w", padx=24)
            e = ctk.CTkEntry(dlg, font=FONT_BODY, fg_color=COLORS["card"],
                             border_color=COLORS["border"])
            e.pack(fill="x", padx=24, pady=(2, 8))
            e.insert(0, existing.get(key, default) if existing else default)
            fields[key] = e

        ctk.CTkLabel(dlg, text="Category", font=FONT_SMALL,
                     text_color=COLORS["muted"]).pack(anchor="w", padx=24)
        cat_var = ctk.StringVar(value=existing.get("category", "Entertainment") if existing else "Entertainment")
        ctk.CTkOptionMenu(dlg, variable=cat_var,
                          values=["Gym", "Music/Audio", "Streaming", "News/Reading", "Software", "Other"],
                          fg_color=COLORS["card"],
                          button_color=COLORS["accent2"]).pack(
            fill="x", padx=24, pady=(2, 16))

        # Active toggle
        active_var = ctk.BooleanVar(value=existing.get("active", True) if existing else True)
        ctk.CTkCheckBox(dlg, text="Active", variable=active_var, 
                        font=FONT_BODY, checkbox_width=20, checkbox_height=20,
                        fg_color=COLORS["accent2"]).pack(anchor="w", padx=24, pady=(0, 16))

        def save():
            rec = {
                "id":       existing["id"] if existing else make_id(),
                "name":     fields["name"].get().strip() or "Subscription",
                "category": cat_var.get(),
                "amount":   fields["amount"].get().strip() or "0",
                "active":   active_var.get(),
                "notes":    fields["notes"].get().strip(),
            }
            if existing:
                idx = next(i for i, x in enumerate(self.data["subscriptions"])
                           if x["id"] == existing["id"])
                self.data["subscriptions"][idx] = rec
            else:
                self.data["subscriptions"].append(rec)
            save_data(self.data)
            self._refresh_subscriptions()
            dlg.destroy()

        ctk.CTkButton(dlg, text="Save", fg_color=COLORS["accent2"],
                      hover_color="#10b981", text_color=COLORS["bg"],
                      font=FONT_BODY, command=save).pack(fill="x", padx=24)

    # ── History & Analytics ────────────────────────────────────────────────────
    def _build_history(self):
        f = self.tabs["history"]
        ctk.CTkLabel(f, text="History & Analytics", font=FONT_TITLE,
                     text_color=COLORS["text"]).pack(anchor="w", padx=30, pady=(30, 5))
        muted_label(f, "View your financial history by date range").pack(
            anchor="w", padx=30, pady=(0, 20))

        # Date range selector
        date_frame = card_frame(f)
        date_frame.pack(fill="x", padx=30, pady=(0, 20))

        ctk.CTkLabel(date_frame, text="Select Date Range", font=FONT_HEAD,
                     text_color=COLORS["text"]).pack(anchor="w", padx=16, pady=(14, 8))

        range_row = ctk.CTkFrame(date_frame, fg_color="transparent")
        range_row.pack(fill="x", padx=16, pady=8)

        # Quick range buttons
        for label, days in [("This Month", 30), ("Last 3 Months", 90), ("This Year", 365), ("All Time", 10000)]:
            ctk.CTkButton(range_row, text=label, font=FONT_SMALL, height=24,
                          fg_color=COLORS["border"], hover_color=COLORS["accent"],
                          command=lambda d=days: self._set_history_range(d)).pack(side="left", padx=4)

        # Manual date range (from/to)
        manual_row = ctk.CTkFrame(date_frame, fg_color="transparent")
        manual_row.pack(fill="x", padx=16, pady=(8, 14))

        ctk.CTkLabel(manual_row, text="From:", font=FONT_SMALL,
                     text_color=COLORS["muted"]).pack(side="left", padx=(0, 4))
        self.hist_from_entry = ctk.CTkEntry(manual_row, font=FONT_SMALL, width=100,
                                             fg_color=COLORS["card"],
                                             border_color=COLORS["border"])
        self.hist_from_entry.pack(side="left", padx=4)
        self.hist_from_entry.insert(0, str(date.today() - __import__('datetime').timedelta(days=30)))

        ctk.CTkLabel(manual_row, text="To:", font=FONT_SMALL,
                     text_color=COLORS["muted"]).pack(side="left", padx=(16, 4))
        self.hist_to_entry = ctk.CTkEntry(manual_row, font=FONT_SMALL, width=100,
                                           fg_color=COLORS["card"],
                                           border_color=COLORS["border"])
        self.hist_to_entry.pack(side="left", padx=4)
        self.hist_to_entry.insert(0, str(date.today()))

        ctk.CTkButton(manual_row, text="Apply", font=FONT_SMALL, height=24,
                      fg_color=COLORS["accent"], hover_color=COLORS["accent"],
                      command=self._refresh_history).pack(side="left", padx=8)

        # Summary stats
        self.hist_summary_frame = ctk.CTkFrame(f, fg_color="transparent")
        self.hist_summary_frame.pack(fill="x", padx=30, pady=(0, 20))

        # show annual income projection based on paychecks
        self._show_annual_income_projection()


        # Historical data table
        self.hist_data_frame = ctk.CTkFrame(f, fg_color="transparent")
        self.hist_data_frame.pack(fill="both", expand=True, padx=30, pady=(0, 30))

        self._refresh_history()

    def _set_history_range(self, days):
        """Set date range based on preset days."""
        to_date = date.today()
        from_date = to_date - __import__('datetime').timedelta(days=days)
        self.hist_from_entry.delete(0, "end")
        self.hist_from_entry.insert(0, str(from_date))
        self.hist_to_entry.delete(0, "end")
        self.hist_to_entry.insert(0, str(to_date))
        self._refresh_history()

    def _refresh_history(self):
        """Refresh history view with selected date range."""
        for w in self.hist_summary_frame.winfo_children():
            w.destroy()
        for w in self.hist_data_frame.winfo_children():
            w.destroy()

        try:
            from_date = datetime.strptime(self.hist_from_entry.get().strip(), "%Y-%m-%d").date()
            to_date = datetime.strptime(self.hist_to_entry.get().strip(), "%Y-%m-%d").date()
        except:
            muted_label(self.hist_summary_frame, "Invalid date format. Use YYYY-MM-DD.").pack()
            return

        d = self.data
        
        # Calculate aggregates for the date range
        total_income = 0
        total_spending = 0
        total_investments = 0

        # Income from paychecks (assuming consistent paychecks)
        for pc in d["paychecks"]:
            freq = pc.get("frequency", "monthly")
            days_diff = (to_date - from_date).days + 1
            if freq == "weekly":
                total_income += parse_amount(pc.get("amount", 0)) * (days_diff / 7)
            elif freq == "biweekly":
                total_income += parse_amount(pc.get("amount", 0)) * (days_diff / 14)
            elif freq == "semimonthly":
                total_income += parse_amount(pc.get("amount", 0)) * (days_diff / 15)
            elif freq == "monthly":
                total_income += parse_amount(pc.get("amount", 0)) * (days_diff / 30)
            elif freq == "quarterly":
                total_income += parse_amount(pc.get("amount", 0)) * (days_diff / 90)
            elif freq == "annually":
                total_income += parse_amount(pc.get("amount", 0)) * (days_diff / 365)

        # Spending in date range
        for spend in d["spending"]:
            try:
                spend_date = datetime.strptime(spend.get("date", str(date.today())), "%Y-%m-%d").date()
                if from_date <= spend_date <= to_date:
                    total_spending += parse_amount(spend.get("amount", 0))
            except:
                pass

        # Monthly contributions (projected)
        days_diff = (to_date - from_date).days + 1
        for inv in d["investments"]:
            total_investments += parse_amount(inv.get("monthly_contribution", 0)) * (days_diff / 30)

        # Subscriptions (projected)
        for sub in d["subscriptions"]:
            if sub.get("active", True):
                total_investments += parse_amount(sub.get("amount", 0)) * (days_diff / 30)

        net = total_income - total_spending - total_investments

        # Display summary
        sum_card = card_frame(self.hist_summary_frame)
        sum_card.pack(fill="x", pady=(0, 16))
        sum_row = ctk.CTkFrame(sum_card, fg_color="transparent")
        sum_row.pack(fill="x", padx=16, pady=14)

        for title, val, color in [
            ("Income", fmt_money(total_income), COLORS["accent2"]),
            ("Spending", fmt_money(total_spending), COLORS["accent3"]),
            ("Investments & Subs", fmt_money(total_investments), COLORS["accent"]),
            ("Net", fmt_money(net), COLORS["accent4"]),
        ]:
            col = ctk.CTkFrame(sum_row, fg_color="transparent")
            col.pack(side="left", expand=True)
            muted_label(col, title).pack()
            ctk.CTkLabel(col, text=val, font=FONT_NUM,
                         text_color=color).pack()

        # Show breakdown by category
        cat_card = card_frame(self.hist_data_frame)
        cat_card.pack(fill="x", pady=(0, 16))
        ctk.CTkLabel(cat_card, text="Spending by Category", font=FONT_HEAD,
                     text_color=COLORS["text"]).pack(anchor="w", padx=16, pady=(14, 8))

        cat_totals = {}
        for spend in d["spending"]:
            try:
                spend_date = datetime.strptime(spend.get("date", str(date.today())), "%Y-%m-%d").date()
                if from_date <= spend_date <= to_date:
                    cat = spend.get("category", "Other")
                    cat_totals[cat] = cat_totals.get(cat, 0) + parse_amount(spend.get("amount", 0))
            except:
                pass

        if cat_totals:
            for cat in sorted(cat_totals.keys()):
                cat_row = ctk.CTkFrame(cat_card, fg_color="transparent")
                cat_row.pack(fill="x", padx=16, pady=4)
                ctk.CTkLabel(cat_row, text=cat, font=FONT_BODY,
                             text_color=COLORS["text"], width=120).pack(side="left")
                ctk.CTkLabel(cat_row, text=fmt_money(cat_totals[cat]), font=FONT_BODY,
                             text_color=COLORS["accent3"]).pack(side="left", padx=20)
        else:
            muted_label(cat_card, "No spending in this period.").pack(anchor="w", padx=16, pady=8)

    # ── Budget Sliders ─────────────────────────────────────────────────────────
    def _slider_changed(self, changed_key):
        vals = {k: v.get() for k, v in self.slider_vals.items()}
        total = sum(vals.values())
        color = COLORS["accent2"] if total == 100 else COLORS["accent3"]
        self.total_label.configure(text=f"Total: {total}%", text_color=color)
        for k, lbl in self.slider_labels.items():
            lbl.configure(text=f"{self.slider_vals[k].get()}%")
        # Refresh breakdown display in real-time
        self._refresh_budget_breakdown()

    def _save_sliders(self):
        vals = {k: v.get() for k, v in self.slider_vals.items()}
        total = sum(vals.values())
        if total != 100:
            dlg = ctk.CTkToplevel(self)
            dlg.title("Warning")
            dlg.geometry("320x120")
            dlg.configure(fg_color=COLORS["surface"])
            dlg.grab_set()
            ctk.CTkLabel(dlg, text=f"Sliders total {total}% — must equal 100%.",
                         font=FONT_BODY, text_color=COLORS["accent3"]).pack(pady=30)
            ctk.CTkButton(dlg, text="OK", command=dlg.destroy,
                          fg_color=COLORS["accent"]).pack()
            return
        self.data["budget_sliders"] = vals
        save_data(self.data)
        self._refresh_budget_breakdown()

    def _show_annual_income_projection(self):
        """Calculate and display projected annual income based on paychecks."""
        d = self.data
        projection = sum(self._monthly_amount(p) for p in d["paychecks"]) * 12
        card = card_frame(self.hist_summary_frame)
        card.pack(fill="x", pady=(0, 16))
        row = ctk.CTkFrame(card, fg_color="transparent")
        row.pack(fill="x", padx=16, pady=14)
        ctk.CTkLabel(row, text="Projected Annual Income", font=FONT_BODY,
                     text_color=COLORS["muted"]).pack(side="left")
        ctk.CTkLabel(row, text=fmt_money(projection), font=FONT_NUM,
                     text_color=COLORS["accent2"]).pack(side="right")

    def _refresh_budget_breakdown(self):
        """Refresh the budget breakdown display based on current slider values."""
        # Skip if widget isn't ready yet (during initialization)
        if not self.winfo_exists() or not hasattr(self, 'ov_breakdown_content'):
            return
        
        # Clear existing content
        try:
            for w in self.ov_breakdown_content.winfo_children():
                w.destroy()
        except:
            return  # Widget path no longer valid, skip
        
        d = self.data
        monthly_income = sum(self._monthly_amount(p) for p in d["paychecks"])
        
        # Use current slider values (not saved)
        current_sliders = {k: self.slider_vals[k].get() for k in self.slider_vals}
        
        # Calculate remaining budget using current slider values
        monthly_investments = sum(parse_amount(i.get("monthly_contribution", 0)) for i in d["investments"])
        remaining = calculate_remaining_budget(monthly_income, current_sliders, d["spending"], str(date.today()), monthly_investments, d.get("subscriptions", []))
        
        # Build breakdown card
        brow = card_frame(self.ov_breakdown_content)
        brow.pack(fill="x")
        ctk.CTkLabel(brow, text="Budget Breakdown",
                     font=FONT_HEAD, text_color=COLORS["text"]).pack(
            anchor="w", padx=16, pady=(14, 8))
        
        # Show each budget category
        for label, key, color in [
            ("Needs",   "needs",   COLORS["accent"]),
            ("Wants",   "wants",   COLORS["accent4"]),
            ("Savings", "savings", COLORS["accent2"]),
        ]:
            pct = current_sliders.get(key, 0)
            budget_info = remaining.get(key, {})
            allocated = budget_info.get("allocated", 0)
            spent = budget_info.get("spent", 0)
            remaining_amt = budget_info.get("remaining", 0)
            percent_used = budget_info.get("percent_used", 0)
            over_budget = budget_info.get("over_budget", False)
            warning = budget_info.get("warning", False)
            
            # Category header row with label and percentage
            header_row = ctk.CTkFrame(brow, fg_color="transparent")
            header_row.pack(fill="x", padx=16, pady=(10, 4))
            
            ctk.CTkLabel(header_row, text=f"{label}", width=70,
                         font=FONT_BODY, text_color=color).pack(side="left")
            ctk.CTkLabel(header_row, text=f"{pct}%",
                         font=FONT_SMALL, text_color=COLORS["text"]).pack(side="left", padx=(12, 0))
            
            # Progress bar row
            bar_row = ctk.CTkFrame(brow, fg_color="transparent")
            bar_row.pack(fill="x", padx=16, pady=(0, 6))
            
            bar_bg = ctk.CTkFrame(bar_row, height=12, corner_radius=6,
                                  fg_color=COLORS["border"])
            bar_bg.pack(fill="x", expand=True)
            
            # Color bar based on budget status
            bar_color = color
            if over_budget:
                bar_color = COLORS["accent3"]  # Red for over-budget
            elif warning and key == "wants":
                bar_color = COLORS["accent4"]  # Yellow for warning
            
            bar_fill = ctk.CTkFrame(bar_bg, height=12, corner_radius=6,
                                    fg_color=bar_color,
                                    width=int(bar_bg.winfo_reqwidth() * min(percent_used / 100, 1)))
            bar_fill.place(relwidth=min(percent_used / 100, 1), relheight=1)
            
            # Amount details row
            details_row = ctk.CTkFrame(brow, fg_color="transparent")
            details_row.pack(fill="x", padx=16, pady=(4, 0))
            
            # Format status text
            if over_budget:
                status_text = f"Spent: {fmt_money(spent)} / {fmt_money(allocated)}  •  ⚠ OVER by {fmt_money(abs(remaining_amt))}"
                status_color = COLORS["accent3"]
            elif warning and key == "wants":
                status_text = f"Spent: {fmt_money(spent)} / {fmt_money(allocated)}  •  ⚠ 80% threshold"
                status_color = COLORS["accent4"]
            else:
                status_text = f"Spent: {fmt_money(spent)} / {fmt_money(allocated)}  •  {fmt_money(remaining_amt)} remaining"
                status_color = COLORS["accent2"] if remaining_amt > 0 else COLORS["accent3"]
            
            ctk.CTkLabel(details_row, text=status_text,
                         font=FONT_SMALL, text_color=status_color).pack(anchor="w")
        
        # Show leftovers if percentages don't add up to 100%
        total_pct = sum(current_sliders.values())
        if total_pct < 100:
            leftovers_pct = 100 - total_pct
            leftovers_amt = monthly_income * leftovers_pct / 100
            
            # Leftovers header row
            header_row = ctk.CTkFrame(brow, fg_color="transparent")
            header_row.pack(fill="x", padx=16, pady=(10, 4))
            
            ctk.CTkLabel(header_row, text="Leftovers", width=70,
                         font=FONT_BODY, text_color=COLORS["muted"]).pack(side="left")
            ctk.CTkLabel(header_row, text=f"{leftovers_pct}%",
                         font=FONT_SMALL, text_color=COLORS["text"]).pack(side="left", padx=(12, 0))
            
            # Progress bar row
            bar_row = ctk.CTkFrame(brow, fg_color="transparent")
            bar_row.pack(fill="x", padx=16, pady=(0, 6))
            
            bar_bg = ctk.CTkFrame(bar_row, height=12, corner_radius=6,
                                  fg_color=COLORS["border"])
            bar_bg.pack(fill="x", expand=True)
            
            bar_fill = ctk.CTkFrame(bar_bg, height=12, corner_radius=6,
                                    fg_color=COLORS["muted"],
                                    width=int(bar_bg.winfo_reqwidth() * 1.0))
            bar_fill.place(relwidth=1.0, relheight=1)
            
            # Amount details row
            details_row = ctk.CTkFrame(brow, fg_color="transparent")
            details_row.pack(fill="x", padx=16, pady=(4, 0))
            
            status_text = f"Unallocated: {fmt_money(leftovers_amt)}"
            ctk.CTkLabel(details_row, text=status_text,
                         font=FONT_SMALL, text_color=COLORS["muted"]).pack(anchor="w")
        
        ctk.CTkFrame(brow, height=14, fg_color="transparent").pack()

    # ── Shared helpers ─────────────────────────────────────────────────────────
    def _delete_item(self, collection, item_id, refresh_fn):
        self.data[collection] = [x for x in self.data[collection]
                                  if x["id"] != item_id]
        save_data(self.data)
        refresh_fn()


if __name__ == "__main__":
    app = FinanceApp()
    app.mainloop()
