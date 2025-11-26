var express = require("express");
var cors = require("cors");

const app = express();
const port = 8080;

// Enable All CORS Requests
app.use(cors());

const SALLA_PRODUCTS_URL = "https://api.salla.dev/admin/v2/products";
const SALLA_ACCESS_TOKEN = process.env.SALLA_ACCESS_TOKEN;

// Shape info for consumers that expect field metadata
const PRODUCT_FIELDS = [
  { name: "id", type: "integer", selector: (product) => product.id },
  { name: "name", type: "string", selector: (product) => product.name },
  { name: "sku", type: "string", selector: (product) => product.sku },
  {
    name: "price_amount",
    type: "float",
    selector: (product) => product.price?.amount ?? null,
  },
  {
    name: "price_currency",
    type: "string",
    selector: (product) => product.price?.currency ?? null,
  },
  {
    name: "tax_amount",
    type: "float",
    selector: (product) => product.tax?.amount ?? null,
  },
  {
    name: "tax_currency",
    type: "string",
    selector: (product) => product.tax?.currency ?? null,
  },
  {
    name: "quantity",
    type: "integer",
    selector: (product) => product.quantity,
  },
  {
    name: "sold_quantity",
    type: "integer",
    selector: (product) => product.sold_quantity,
  },
  {
    name: "status",
    type: "string",
    selector: (product) => product.status,
  },
  {
    name: "is_available",
    type: "boolean",
    selector: (product) => product.is_available,
  },
  { name: "views", type: "integer", selector: (product) => product.views },
  {
    name: "sale_price_amount",
    type: "float",
    selector: (product) => product.sale_price?.amount ?? null,
  },
  {
    name: "sale_price_currency",
    type: "string",
    selector: (product) => product.sale_price?.currency ?? null,
  },
  {
    name: "regular_price_amount",
    type: "float",
    selector: (product) => product.regular_price?.amount ?? null,
  },
  {
    name: "regular_price_currency",
    type: "string",
    selector: (product) => product.regular_price?.currency ?? null,
  },
  { name: "weight", type: "float", selector: (product) => product.weight },
  {
    name: "weight_type",
    type: "string",
    selector: (product) => product.weight_type,
  },
  {
    name: "with_tax",
    type: "boolean",
    selector: (product) => product.with_tax,
  },
  {
    name: "updated_at",
    type: "string",
    selector: (product) => product.updated_at,
  },
];

const PUBLIC_FIELD_DEFINITIONS = PRODUCT_FIELDS.map(
  ({ selector, ...rest }) => rest
);

const mapProductToVariables = (product) =>
  PRODUCT_FIELDS.reduce((acc, field) => {
    acc[field.name] = field.selector(product);
    return acc;
  }, {});

const buildRows = (products) =>
  products.map((product) =>
    PRODUCT_FIELDS.map((field) => field.selector(product))
  );

// Proxy Salla products endpoint so the frontend can fetch real data
app.get("/", async (req, res) => {
  try {
    const url = new URL(SALLA_PRODUCTS_URL);
    Object.entries(req.query).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.set(key, value);
      }
    });

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${SALLA_ACCESS_TOKEN}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Salla API responded with ${response.status}: ${errorBody || "no body"}`
      );
    }

    const payload = await response.json();
    const products = Array.isArray(payload.data) ? payload.data : [];
    const productVariables = products.map(mapProductToVariables);

    res.status(200).json({
      success: true,
      status: 200,
      data: {
        fields: PUBLIC_FIELD_DEFINITIONS,
        rows: buildRows(products),
        rowCount: productVariables.length,
        cursor: payload.pagination
          ? {
              current: payload.pagination.currentPage,
              previous:
                payload.pagination.currentPage > 1
                  ? payload.pagination.currentPage - 1
                  : null,
              next:
                payload.pagination.currentPage < payload.pagination.totalPages
                  ? payload.pagination.currentPage + 1
                  : null,
              count: payload.pagination.total,
            }
          : null,
      },
      products: productVariables,
      pagination: payload.pagination ?? null,
    });
  } catch (error) {
    console.error("Failed to fetch Salla products:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch data from Salla API",
      error: error.message,
    });
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
