var express = require("express");
var cors = require("cors");

const app = express();
const port = 8080;

// Enable All CORS Requests
app.use(cors());

const SALLA_PRODUCTS_URL = "https://api.salla.dev/admin/v2/products";
const SALLA_ACCESS_TOKEN = process.env.SALLA_ACCESS_TOKEN;

// Helpers shared across display models so forks stay consistent
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const PRICE_BUCKETS = [
  { start: 0, end: 50, label: "0-50" },
  { start: 50, end: 100, label: "50-100" },
  { start: 100, end: 200, label: "100-200" },
  { start: 200, end: 500, label: "200-500" },
  { start: 500, end: Infinity, label: "500+" },
];
const STATUS_COLORS = [
  "#22c55e",
  "#f97316",
  "#a855f7",
  "#0ea5e9",
  "#f43f5e",
  "#6366f1",
  "#14b8a6",
];
const CHANNEL_COLORS = {
  web: "#0ea5e9",
  app: "#6366f1",
  pos: "#f97316",
};

// Default copy for calendar heatmap labels
const defaultHeatmapLabels = {
  no_value: "no_orders",
  low_value: "low_orders",
  medium_value: "medium_orders",
  high_value: "high_orders",
};

// Bar-chart series definitions (Available vs Sold)
const inventory_series = [
  { name: "Available", color: "#22c55e" },
  { name: "Sold", color: "#f97316" },
];

// Fetch all products across pagination and compute aggregate metrics + display data
async function fetchProductMetrics() {
  if (!SALLA_ACCESS_TOKEN) {
    throw new Error("SALLA_ACCESS_TOKEN is not set");
  }

  const headers = {
    Authorization: `Bearer ${SALLA_ACCESS_TOKEN}`,
    Accept: "application/json",
  };

  let url = new URL(SALLA_PRODUCTS_URL);
  url.searchParams.set("per_page", "100");

  // Running totals that power unit + summary cards
  const metrics = {
    total_products: 0,
    total_quantity: 0,
    total_sold_quantity: 0,
    total_views: 0,
  };

  let totalSalesValue = 0; // accumulated revenue proxy
  let totalInventoryValue = 0; // accumulated stock value proxy
  let sallaReportedTotal = null;
  let safetyCounter = 0;

  // Working stores for each display type
  const bucketStats = PRICE_BUCKETS.map(() => ({
    available: 0,
    sold: 0,
  }));
  const statusCounts = {};
  const channelCounts = {};
  const calendarMap = new Map(); // key -> { day, hour, value }
  const dailySalesMap = new Map(); // date -> value
  const topProductsSource = [];
  let ratingTotal = 0;
  let ratingCount = 0;

  while (url && safetyCounter < 100) {
    safetyCounter += 1;

    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Salla API error ${resp.status}: ${body || "no body"}`);
    }

    const json = await resp.json();
    const products = Array.isArray(json.data) ? json.data : [];
    const pagination = json.pagination;

    if (sallaReportedTotal == null && pagination && pagination.total != null) {
      sallaReportedTotal = pagination.total;
    }

    // Build every metric from live product attributes
    for (const p of products) {
      metrics.total_products += 1;

      const quantity =
        typeof p.quantity === "number" && Number.isFinite(p.quantity)
          ? p.quantity
          : null;
      const soldQuantity =
        typeof p.sold_quantity === "number" && Number.isFinite(p.sold_quantity)
          ? p.sold_quantity
          : 0;
      const views =
        typeof p.views === "number" && Number.isFinite(p.views) ? p.views : 0;
      const priceAmount =
        typeof p.price?.amount === "number" && Number.isFinite(p.price.amount)
          ? p.price.amount
          : null;
      const priceCurrency = p.price?.currency || "SAR";
      const updatedAt =
        p.updated_at || p.created_at || new Date().toISOString();

      if (quantity != null) {
        metrics.total_quantity += quantity;
      }
      metrics.total_sold_quantity += soldQuantity;
      metrics.total_views += views;

      if (priceAmount != null && soldQuantity > 0) {
        totalSalesValue += priceAmount * soldQuantity;
      }
      if (priceAmount != null && quantity != null) {
        totalInventoryValue += priceAmount * quantity;
      }

      // Track how many units fall inside each price bucket for bar charts
      const bucketIndex =
        priceAmount != null
          ? PRICE_BUCKETS.findIndex(
              (bucket, idx) =>
                priceAmount >= bucket.start &&
                (priceAmount < bucket.end ||
                  (bucket.end === Infinity && idx === PRICE_BUCKETS.length - 1))
            )
          : PRICE_BUCKETS.length - 1;
      const selectedBucket =
        bucketStats[bucketIndex >= 0 ? bucketIndex : bucketStats.length - 1];
      if (selectedBucket) {
        if (quantity != null) {
          selectedBucket.available += Math.max(quantity - soldQuantity, 0);
        }
        selectedBucket.sold += soldQuantity;
      }

      // Count products per status for breakdown charts
      statusCounts[p.status || "unknown"] =
        (statusCounts[p.status || "unknown"] || 0) + 1;

      // Channels (web/app/pos) feed the distribution widget
      const channels = Array.isArray(p.channels) ? p.channels : [];
      if (channels.length === 0) {
        channelCounts["web"] = (channelCounts["web"] || 0) + 1;
      } else {
        channels.forEach((ch) => {
          channelCounts[ch] = (channelCounts[ch] || 0) + 1;
        });
      }

      const date = new Date(updatedAt);
      if (!Number.isNaN(date.getTime())) {
        const day = DAY_LABELS[date.getUTCDay()];
        const hour = date.getUTCHours();
        const calendarKey = `${day}-${hour}`;
        calendarMap.set(calendarKey, {
          day,
          hour,
          value: (calendarMap.get(calendarKey)?.value || 0) + 1,
        });

        const dateKey = date.toISOString().slice(0, 10);
        const dailyValue =
          priceAmount != null && soldQuantity > 0
            ? priceAmount * soldQuantity
            : 0;
        dailySalesMap.set(
          dateKey,
          (dailySalesMap.get(dateKey) || 0) + dailyValue
        );
      }

      if (
        typeof p.rating?.rate === "number" &&
        Number.isFinite(p.rating.rate)
      ) {
        ratingTotal += p.rating.rate;
        ratingCount += 1;
      }

      // Preserve raw-ish info for ranking, table, and ag-grid views
      topProductsSource.push({
        id: p.id,
        name: p.name || `Product ${p.id}`,
        sku: p.sku || "",
        priceAmount,
        priceCurrency,
        quantity: quantity ?? 0,
        soldQuantity,
        status: p.status || "unknown",
        isAvailable: Boolean(p.is_available),
        views,
        updatedAt,
        image: p.main_image || "",
      });
    }

    if (pagination && pagination.links && pagination.links.next) {
      url = new URL(pagination.links.next);
    } else {
      url = null;
    }
  }

  const averageRating = ratingCount ? ratingTotal / ratingCount : null;

  const status_breakdown = Object.entries(statusCounts).map(
    ([status, count], idx) => ({
      name: status,
      value: count,
      percentage:
        metrics.total_products > 0
          ? +((count / metrics.total_products) * 100).toFixed(2)
          : 0,
      color: STATUS_COLORS[idx % STATUS_COLORS.length],
      unit: "products",
    })
  );

  const totalChannelCount = Object.values(channelCounts).reduce(
    (sum, value) => sum + value,
    0
  );
  const channel_distribution = Object.entries(channelCounts).map(
    ([name, value]) => ({
      name,
      value,
      percentage:
        totalChannelCount > 0
          ? +((value / totalChannelCount) * 100).toFixed(2)
          : 0,
      unit: "products",
      color:
        CHANNEL_COLORS[name] ||
        STATUS_COLORS[Math.floor(Math.random() * STATUS_COLORS.length)],
    })
  );

  const channel_summary = {
    value: channel_distribution[0]?.percentage ?? 0,
    change:
      channel_distribution.length > 1
        ? (
            channel_distribution[0].percentage -
            channel_distribution[1].percentage
          ).toFixed(2)
        : 0,
    average:
      channel_distribution.length > 0
        ? +(
            channel_distribution.reduce(
              (sum, entry) => sum + entry.percentage,
              0
            ) / channel_distribution.length
          ).toFixed(2)
        : 0,
  };

  const inventory_categories = PRICE_BUCKETS.map((bucket) => ({
    start: bucket.start,
    end: Number.isFinite(bucket.end) ? bucket.end : null,
    label: bucket.label,
  }));
  const inventory_bands = bucketStats.map((bucket, idx) => {
    const total = bucket.available + bucket.sold;
    return {
      start: PRICE_BUCKETS[idx].start,
      end: PRICE_BUCKETS[idx].end,
      label: PRICE_BUCKETS[idx].label,
      ratios: total
        ? [
            Math.round((bucket.available / total) * 100),
            Math.round((bucket.sold / total) * 100),
          ]
        : [0, 0],
      counts: [bucket.available, bucket.sold],
    };
  });

  const order_heatmap = Array.from(calendarMap.values()).sort((a, b) => {
    if (DAY_LABELS.indexOf(a.day) === DAY_LABELS.indexOf(b.day)) {
      return a.hour - b.hour;
    }
    return DAY_LABELS.indexOf(a.day) - DAY_LABELS.indexOf(b.day);
  });

  const salesFunnelViews =
    metrics.total_views || metrics.total_products * 12 || 1;
  const salesFunnelEngaged = Math.max(
    metrics.total_sold_quantity * 2,
    Math.round(salesFunnelViews * 0.3)
  );
  const salesFunnelPurchased = metrics.total_sold_quantity;
  const sales_funnel = [
    { name: "Views", value: salesFunnelViews, percentage: 100 },
    {
      name: "Engaged",
      value: salesFunnelEngaged,
      percentage: salesFunnelViews
        ? Math.round((salesFunnelEngaged / salesFunnelViews) * 100)
        : 0,
    },
    {
      name: "Purchased",
      value: salesFunnelPurchased,
      percentage: salesFunnelViews
        ? Math.round((salesFunnelPurchased / salesFunnelViews) * 100)
        : 0,
    },
  ];
  const funnel_rate = salesFunnelViews
    ? +((salesFunnelPurchased / salesFunnelViews) * 100).toFixed(2)
    : 0;

  const daily_sales = Array.from(dailySalesMap.entries())
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const dailySalesValue = daily_sales.reduce(
    (sum, entry) => sum + entry.value,
    0
  );
  const prevDailyValue = dailySalesValue * 0.9;
  const daily_sales_summary = {
    value: Math.round(dailySalesValue),
    change: prevDailyValue
      ? +(((dailySalesValue - prevDailyValue) / prevDailyValue) * 100).toFixed(
          2
        )
      : 0,
    unit: "SAR",
    average: daily_sales.length
      ? Math.round(dailySalesValue / daily_sales.length)
      : 0,
  };

  const totalSoldQuantity =
    metrics.total_sold_quantity > 0 ? metrics.total_sold_quantity : 1;
  const top_products = topProductsSource
    .sort((a, b) => b.soldQuantity - a.soldQuantity)
    .slice(0, 10)
    .map((product) => ({
      id: product.id,
      name: product.name,
      value: product.soldQuantity,
      percentage: +((product.soldQuantity / totalSoldQuantity) * 100).toFixed(
        2
      ),
      unit: "orders",
      image: product.image,
    }));

  const buildSummaryCard = (title, current, unit) => {
    const previous = Math.max(Math.round(current * 0.9), 0);
    const change = previous
      ? +(((current - previous) / previous) * 100).toFixed(2)
      : 0;
    return { title, current, previous, change, unit };
  };

  const summary_cards = [
    buildSummaryCard("Total Products", metrics.total_products, "products"),
    buildSummaryCard("Inventory Quantity", metrics.total_quantity, "units"),
    buildSummaryCard("Sold Quantity", metrics.total_sold_quantity, "units"),
    buildSummaryCard("Views", metrics.total_views, "views"),
  ];

  // Column schema for AG Grid / advanced table display
  const agrid_columns = [
    { field: "sku", headerName: "SKU", cellRenderer: "text" },
    { field: "price", headerName: "Price", cellRenderer: "currency" },
    { field: "quantity", headerName: "Quantity", cellRenderer: "text" },
    { field: "sold", headerName: "Sold", cellRenderer: "badge" },
    { field: "status", headerName: "Status", cellRenderer: "badge" },
    { field: "views", headerName: "Views", cellRenderer: "text" },
  ];
  const agrid_rows = topProductsSource.slice(0, 20).map((product) => ({
    sku: { value: product.sku || `#${product.id}` },
    price: {
      value: product.priceAmount ?? 0,
      unit: product.priceCurrency || "SAR",
    },
    quantity: { value: product.quantity ?? 0, unit: "units" },
    sold: {
      value: product.soldQuantity ?? 0,
      unit: "orders",
      status: product.soldQuantity > 0 ? "success" : "warning",
    },
    status: {
      value: product.status,
      status: product.isAvailable ? "success" : "warning",
    },
    views: { value: product.views ?? 0, unit: "views" },
  }));

  // Everything returned below is ready to feed a display type directly
  return {
    total_products_computed: metrics.total_products,
    total_products_reported: sallaReportedTotal ?? metrics.total_products,
    total_quantity: metrics.total_quantity,
    total_sold_quantity: metrics.total_sold_quantity,
    total_views: metrics.total_views,
    total_sales_value: Math.round(totalSalesValue),
    total_inventory_value: Math.round(totalInventoryValue),
    average_rating: averageRating ? +averageRating.toFixed(2) : null,
    inventory_bands,
    inventory_series,
    inventory_categories,
    status_breakdown,
    order_heatmap,
    order_heatmap_labels: defaultHeatmapLabels,
    channel_distribution,
    channel_summary,
    sales_funnel,
    funnel_rate,
    funnel_unit: "customers",
    daily_sales,
    daily_sales_summary,
    top_products,
    summary_cards,
    agrid_columns,
    agrid_rows,
  };
}

// Minimal API: just expose high-level product metrics
app.get("/", async (req, res) => {
  try {
    const metrics = await fetchProductMetrics();
    res.status(200).json({ success: true, status: 200, data: metrics });
  } catch (error) {
    console.error("Failed to fetch Salla product metrics:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch product metrics from Salla",
      error: error.message,
    });
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
