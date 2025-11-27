README – Salla Metrics Server

## Overview

This tiny Express server connects to the **Salla Admin API** and returns **high-level product metrics** only (no product details).  
It is designed to be:
- **Simple to read and fork**
- **Safe for open source** (no tokens in code)
- **Easy to consume with JMESPath**, including your *unit report* display type.

The core idea:
- Server calls `https://api.salla.dev/admin/v2/products` with your access token.
- It walks through **all pages** using Salla’s pagination.
- It computes **totals** (counts, quantities, etc.).
- It returns a rich JSON object where every block maps to a display type (unit, bar, breakdown, calendar, distribution, pipe, plot, ranking, summary, AG grid).

---

## Prerequisites

- **Node.js** (you already have it; works with Node 18+ and Node 20+).
- **Salla access token** with permission to read products.
- Basic familiarity with:
  - **JMESPath** – JSON query language: [jmespath.org](https://jmespath.org/)
  - **Salla Merchant APIs** – [docs.salla.dev](https://docs.salla.dev/)

---

## Environment setup

The server reads your Salla token from an environment variable called `SALLA_ACCESS_TOKEN`.

- **Locally (terminal):**

  ```bash
  export SALLA_ACCESS_TOKEN="YOUR_SALLA_ACCESS_TOKEN"
  node "var express = require(\"express\");.jsx"
  ```

- **On CodeSandbox:**
  - Open the **Environment Variables** / **Secrets** panel.
  - Add a variable named `SALLA_ACCESS_TOKEN`.
  - Paste your Salla access token as the value and save.
  - Start the server (CodeSandbox will run the Node entry file and inject the env variable).

Keeping the token in the environment (and out of the code) makes this project safe to fork and share publicly.

---

## Server code (conceptual)

The actual server file is `var express = require("express");.jsx`.  
At a high level it:

1. **Bootstraps** Express + CORS and reads `SALLA_ACCESS_TOKEN`.
2. **Paginates through every product** (`per_page=100`, follows `pagination.links.next`).
3. **Aggregates on the fly**:
   - Core totals (products, quantity, sold, views, sales value, inventory value, rating).
   - Bucketed counts for bar charts, status/channel breakdowns, calendar heatmap cells, funnel stats, daily revenue map, top products, summary cards, and AG Grid rows.
4. **Returns a single JSON payload** where every section (`inventory_bands`, `status_breakdown`, `sales_funnel`, `daily_sales`, `summary_cards`, `agrid_rows`, etc.) is ready to plug into its display type.

Forkers typically only need to:
- Set `SALLA_ACCESS_TOKEN`.
- Optionally adjust bucket definitions, add/remove metrics, or expose extra endpoints.

---

## Response shape

`GET /` returns:

```json
{
  "success": true,
  "status": 200,
  "data": {
    "total_products_computed": 21,
    "total_products_reported": 21,
    "total_quantity": 45,
    "total_sold_quantity": 123,
    "total_views": 0,
    "total_sales_value": 27450,
    "total_inventory_value": 91200,
    "average_rating": 4.2,
    "inventory_bands": [...],
    "inventory_series": [...],
    "inventory_categories": [...],
    "status_breakdown": [...],
    "order_heatmap": [...],
    "order_heatmap_labels": {...},
    "channel_distribution": [...],
    "channel_summary": {...},
    "sales_funnel": [...],
    "funnel_rate": 3.7,
    "funnel_unit": "customers",
    "daily_sales": [...],
    "daily_sales_summary": {...},
    "top_products": [...],
    "summary_cards": [...],
    "agrid_columns": [...],
    "agrid_rows": [...]
  }
}
```

### Data dictionary (what each block feeds)

| Field / Block | Purpose | Display type |
| --- | --- | --- |
| `total_products_computed`, `total_products_reported`, `total_quantity`, `total_sold_quantity`, `total_views` | Core totals used for KPI/unit cards and summary rows | Unit, Summary |
| `total_sales_value`, `total_inventory_value`, `average_rating` | Monetary + rating aggregates for richer cards | Unit, Summary |
| `inventory_bands`, `inventory_series`, `inventory_categories` | Price-bucket stats (available vs sold) | Bar |
| `status_breakdown` | Product counts per status (`sale`, `hidden`, etc.) | Breakdown |
| `order_heatmap`, `order_heatmap_labels` | Day/hour intensity derived from update timestamps | Calendar |
| `channel_distribution`, `channel_summary` | Product channel shares (web/app/pos) with summary stats | Distribution |
| `sales_funnel`, `funnel_rate`, `funnel_unit` | Synthetic funnel (views → engaged → purchased) | Pipe |
| `daily_sales`, `daily_sales_summary` | Approx revenue per day (price × sold) + summary | Plot |
| `top_products` | Top sellers with percentage share and image | Ranking |
| `summary_cards` | Ready-made summary widgets (title/current/previous/change/unit) | Summary |
| `agrid_columns`, `agrid_rows` | Column schema + row data for AG Grid/table view | Agrid |

---

## Using JMESPath with this API

The server is designed to work nicely with **JMESPath** expressions.

### Basic examples

## Display type examples

These examples map the live `/` response directly onto each report type.  
Copy/paste the expressions as-is (they assume the root JSON looks like `{ success, status, data }`).

### Unit report

`@.{value: data.total_sales_value, change: data.total_sold_quantity, unit: 'SAR', average: data.daily_sales_summary.average, reviews: {value: coalesce(data.average_rating, \`0\`), total: 5}}`

### Bar report (inventory buckets)

`@.{bars: data.inventory_bands, series: data.inventory_series, categories: data.inventory_categories}`

### Breakdown report (status)

`@.data.status_breakdown`

### Calendar report (heatmap)

`@.{calendar: data.order_heatmap, labels: data.order_heatmap_labels}`

### Distribution report (channels)

`@.{value: data.channel_summary.value, change: data.channel_summary.change, average: data.channel_summary.average, distribution: data.channel_distribution}`

### Pipe report (sales funnel)

`@.{plot: data.sales_funnel, rate: data.funnel_rate, unit: data.funnel_unit}`

### Plot report (daily revenue)

`@.{value: data.daily_sales_summary.value, change: data.daily_sales_summary.change, unit: data.daily_sales_summary.unit, plot: data.daily_sales}`

### Ranking report (top products)

`@.data.top_products`

### Summary report (cards)

`@.data.summary_cards`

### Agrid report (table)

`@.{columns: data.agrid_columns, rows: data.agrid_rows}`

---
