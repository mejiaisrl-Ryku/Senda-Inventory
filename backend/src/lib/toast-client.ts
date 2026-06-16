// Native fetch (Node 20+) — no external HTTP client needed.

function cfg() {
  return {
    clientId:     process.env.TOAST_CLIENT_ID     ?? "",
    clientSecret: process.env.TOAST_CLIENT_SECRET ?? "",
    redirectUri:  process.env.TOAST_REDIRECT_URI  ?? "",
    apiBase:      process.env.TOAST_API_BASE_URL   ?? "https://ws-sandbox-api.toasttab.com",
    authBase:     process.env.TOAST_AUTH_URL       ?? "https://www.toasttab.com/authentication/oauth/authorize",
    tokenUrl:     process.env.TOAST_TOKEN_URL      ?? "https://ws-sandbox-api.toasttab.com/authentication/v1/authentication/login",
  };
}

export interface ToastTokens {
  accessToken:  string;
  refreshToken: string;
  expiresIn:    number;
}

export interface ToastRestaurantInfo {
  locationGuid:   string;
  restaurantName: string;
}

/** Returns the OAuth 2.0 authorization URL to redirect the user to. */
export function getAuthorizationUrl(state: string): string {
  const { clientId, redirectUri, authBase } = cfg();
  const params = new URLSearchParams({
    response_type: "code",
    client_id:     clientId,
    redirect_uri:  redirectUri,
    scope:         "restaurants:read orders:read",
    state,
  });
  return `${authBase}?${params.toString()}`;
}

async function postForm(url: string, params: URLSearchParams): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    params.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Toast API ${res.status}: ${text}`);
  }
  return res.json() as Promise<Record<string, unknown>>;
}

/** Exchange an authorization code for access + refresh tokens. */
export async function exchangeCodeForToken(code: string): Promise<ToastTokens> {
  const { clientId, clientSecret, redirectUri, tokenUrl } = cfg();
  const data = await postForm(tokenUrl, new URLSearchParams({
    grant_type:    "authorization_code",
    code,
    redirect_uri:  redirectUri,
    client_id:     clientId,
    client_secret: clientSecret,
  }));
  return {
    accessToken:  data.access_token  as string,
    refreshToken: data.refresh_token as string,
    expiresIn:    (data.expires_in   as number) ?? 3600,
  };
}

/** Use a refresh token to get a new access token. */
export async function refreshAccessToken(refreshToken: string): Promise<ToastTokens> {
  const { clientId, clientSecret, tokenUrl } = cfg();
  const data = await postForm(tokenUrl, new URLSearchParams({
    grant_type:    "refresh_token",
    refresh_token: refreshToken,
    client_id:     clientId,
    client_secret: clientSecret,
  }));
  return {
    accessToken:  data.access_token  as string,
    refreshToken: (data.refresh_token as string | undefined) ?? refreshToken,
    expiresIn:    (data.expires_in   as number) ?? 3600,
  };
}

// ── Transaction + menu item types ────────────────────────────────────────────

export interface ToastTransactionItem {
  toastItemId: string;
  name:        string;
  qty:         number;
  unitPrice:   number;
}

export interface ToastTransactionRecord {
  id:       string;       // Toast order / check GUID
  date:     string;       // ISO 8601
  amount:   number;       // total value
  category: string;       // e.g. "FOOD", "DELIVERY"
  items:    ToastTransactionItem[];
  raw:      Record<string, unknown>; // original JSON
}

export interface ToastMenuItemRecord {
  id:       string;
  name:     string;
  price:    number;
  category: string;
}

/** Fetch orders/checks in a date range. Handles pagination. */
export async function getTransactions(
  accessToken:  string,
  locationGuid: string,
  startDate:    Date,
  endDate:      Date
): Promise<ToastTransactionRecord[]> {
  const { apiBase } = cfg();
  const start = startDate.toISOString().split("T")[0];
  const end   = endDate.toISOString().split("T")[0];

  const results: ToastTransactionRecord[] = [];
  let page = 1;

  while (true) {
    const url = `${apiBase}/orders/v2/orders?restaurantGuid=${encodeURIComponent(locationGuid)}&startDate=${start}&endDate=${end}&pageSize=100&page=${page}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Toast orders API ${res.status}: ${text}`);
    }

    const data = await res.json() as Record<string, unknown>[] | { orders?: Record<string, unknown>[] };
    const orders = Array.isArray(data) ? data : (data.orders ?? []) as Record<string, unknown>[];

    for (const order of orders) {
      const checks = (order.checks as Record<string, unknown>[] | undefined) ?? [];
      for (const check of checks) {
        const selections = (check.selections as Record<string, unknown>[] | undefined) ?? [];
        results.push({
          id:       (order.guid as string | undefined) ?? (order.id as string | undefined) ?? String(order.orderNumber ?? ""),
          date:     (order.openedDate as string | undefined) ?? new Date().toISOString(),
          amount:   (check.totalAmount as number | undefined) ?? 0,
          category: (order.diningOption as string | undefined) ?? "FOOD",
          items:    selections.map((s) => ({
            toastItemId: (s.itemGuid as string | undefined) ?? "",
            name:        (s.displayName as string | undefined) ?? "",
            qty:         (s.quantity   as number | undefined) ?? 1,
            unitPrice:   (s.unitOfMeasure as number | undefined) ?? (s.price as number | undefined) ?? 0,
          })),
          raw: order,
        });
      }
    }

    if (orders.length < 100) break; // last page
    page++;
  }

  return results;
}

/** Fetch the restaurant's full menu. */
export async function getMenuItems(
  accessToken:  string,
  locationGuid: string
): Promise<ToastMenuItemRecord[]> {
  const { apiBase } = cfg();
  const res = await fetch(
    `${apiBase}/config/v2/menus?restaurantGuid=${encodeURIComponent(locationGuid)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Toast menu API ${res.status}: ${text}`);
  }

  const data = await res.json() as Record<string, unknown>[] | { menus?: Record<string, unknown>[] };
  const menus = Array.isArray(data) ? data : (data.menus ?? []) as Record<string, unknown>[];

  const items: ToastMenuItemRecord[] = [];
  for (const menu of menus) {
    const groups = (menu.menuGroups as Record<string, unknown>[] | undefined) ?? [];
    for (const group of groups) {
      const menuItems = (group.menuItems as Record<string, unknown>[] | undefined) ?? [];
      for (const item of menuItems) {
        items.push({
          id:       (item.guid     as string | undefined) ?? "",
          name:     (item.name     as string | undefined) ?? "",
          price:    (item.price    as number | undefined) ?? 0,
          category: (item.salesCategory as string | undefined) ?? "FOOD",
        });
      }
    }
  }

  return items;
}

/** Fetch the restaurant's Toast location GUID and display name. */
export async function getRestaurantInfo(accessToken: string): Promise<ToastRestaurantInfo> {
  const { apiBase } = cfg();
  const res = await fetch(`${apiBase}/restaurants/v1/groups`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Toast restaurants API ${res.status}: ${text}`);
  }
  const data = await res.json() as Record<string, unknown> | Record<string, unknown>[];
  const location = Array.isArray(data) ? data[0] as Record<string, unknown> : data;
  return {
    locationGuid:   (location?.guid          as string | undefined) ?? (location?.restaurantGuid as string | undefined) ?? "",
    restaurantName: (location?.restaurantName as string | undefined) ?? (location?.name           as string | undefined) ?? "",
  };
}
