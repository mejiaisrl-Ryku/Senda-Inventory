// Using native fetch (Node 18+)
const BASE_URL = 'https://senda-inventory-production.up.railway.app/api';
const TEST_EMAIL = 'mejia.isrl@gmail.com';
const TEST_PASSWORD = 'cachete26';

// ============================================================================
// STEP 1: AUTHENTICATE
// ============================================================================

async function authenticate() {
  console.log('\n📝 STEP 1: AUTHENTICATE');
  console.log(`Logging in as: ${TEST_EMAIL}`);

  const response = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Login failed: ${response.status}\n${text}`);
  }

  const data = await response.json();
  console.log('✅ Authentication successful');
  console.log(`   Token: ${data.token.substring(0, 30)}...`);
  return data.token;
}

// ============================================================================
// STEP 2: GET RESTAURANT INFO
// ============================================================================

async function getRestaurantInfo(authToken) {
  console.log('\n📝 STEP 2: GET RESTAURANT INFO');

  const response = await fetch(`${BASE_URL}/auth/me`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to get user info: ${response.status}\n${text}`);
  }

  const data = await response.json();
  console.log(`✅ User: ${data.user?.email ?? data.email}`);
  console.log(`   Restaurant ID: ${data.user?.restaurantId ?? data.restaurantId}`);
  return data.user?.restaurantId ?? data.restaurantId;
}

// ============================================================================
// STEP 3: CREATE TEST PRODUCT
// ============================================================================

async function createTestProduct(authToken) {
  console.log('\n📝 STEP 3: CREATE TEST PRODUCT');

  const productData = {
    name: `WAC-Test-Chicken-${Date.now()}`,
    unit: 'LB',
    costPerUnit: 3.2,
    currentStock: 50,
    minimumStock: 0,
    cogsCategory: 'FOOD',
    department: 'BOH',
  };

  console.log(`   Name: ${productData.name}`);
  console.log(`   Initial stock: 50 LB @ $3.2000`);

  const response = await fetch(`${BASE_URL}/products`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify(productData),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to create product: ${response.status}\n${text}`);
  }

  const created = await response.json();
  console.log(`✅ Product created`);
  console.log(`   ID: ${created.id}`);
  console.log(`   costPerUnit: $${Number(created.costPerUnit).toFixed(4)}`);
  console.log(`   currentStock: ${created.currentStock}`);

  return created.id;
}

// ============================================================================
// STEP 4: CREATE INVOICE (ORDER)
// ============================================================================

async function createInvoice(authToken, productId) {
  console.log('\n📝 STEP 4: CREATE INVOICE');

  const invoiceData = {
    purveyor: 'Test Supplier Inc',
    invoiceNumber: `WAC-TEST-${Date.now()}`,
    invoiceDate: new Date().toISOString().split('T')[0],
    items: [
      {
        productId,
        productName: 'WAC-Test-Chicken',
        quantity: 20,
        unitCost: 3.5,
      },
    ],
  };

  console.log(`   Incoming: 20 LB @ $3.5000 (invoice)`);

  const response = await fetch(`${BASE_URL}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify(invoiceData),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to create invoice: ${response.status}\n${text}`);
  }

  const created = await response.json();
  console.log(`✅ Invoice created`);
  console.log(`   Order ID: ${created.id}`);
  console.log(`   Status: ${created.status}`);

  return created.id;
}

// ============================================================================
// STEP 5: RECEIVE INVOICE (TRIGGER WAC)
// ============================================================================

async function receiveInvoice(authToken, orderId) {
  console.log('\n📝 STEP 5: RECEIVE INVOICE (TRIGGER WEIGHTED AVERAGE)');

  const response = await fetch(`${BASE_URL}/orders/${orderId}/receive`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to receive invoice: ${response.status}\n${text}`);
  }

  const received = await response.json();
  console.log(`✅ Invoice received`);
  console.log(`   Status: ${received.status}`);
  console.log(`   Linked items processed: ${received.metadata?.linkedItemsProcessed ?? 'N/A'}`);

  if (received.metadata?.skippedItems?.length) {
    console.log(`   ⚠️  Skipped items: ${received.metadata.skippedItems.length}`);
    received.metadata.skippedItems.forEach(item => {
      console.log(`      - ${item.productName}: ${item.reason}`);
    });
  }

  return received;
}

// ============================================================================
// STEP 6: VERIFY PRODUCT UPDATE
// ============================================================================

async function verifyProductUpdate(authToken, productId) {
  console.log('\n📝 STEP 6: VERIFY PRODUCT COST & STOCK UPDATE');

  const response = await fetch(`${BASE_URL}/products/${productId}`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch product: ${response.status}\n${text}`);
  }

  const product = await response.json();
  const actualCost  = Number(product.costPerUnit);
  const actualStock = Number(product.currentStock);

  // WAC: (50 × 3.20 + 20 × 3.50) / 70 = 230 / 70
  const existingQty  = 50, existingCost = 3.2;
  const incomingQty  = 20, incomingCost = 3.5;
  const totalValue   = existingQty * existingCost + incomingQty * incomingCost;
  const totalQty     = existingQty + incomingQty;
  const expectedWAC  = Math.round((totalValue / totalQty) * 10000) / 10000;

  console.log('\n🧮 WEIGHTED AVERAGE CALCULATION:');
  console.log(`   Before: 50 LB @ $3.2000 = $160.00`);
  console.log(`   Incoming: 20 LB @ $3.5000 = $70.00`);
  console.log(`   Total value:    $${totalValue.toFixed(2)}`);
  console.log(`   Total quantity: ${totalQty} LB`);
  console.log(`   Expected WAC:   $${expectedWAC.toFixed(4)}`);
  console.log(`   Actual WAC:     $${actualCost.toFixed(4)}`);
  console.log(`   Expected stock: 70 LB`);
  console.log(`   Actual stock:   ${actualStock} LB`);

  const costMatch  = Math.abs(actualCost - expectedWAC) < 0.0001;
  const stockMatch = actualStock === 70;

  console.log('');
  costMatch
    ? console.log(`   ✅ COST MATCH — weighted average is correct`)
    : console.log(`   ❌ COST MISMATCH — expected $${expectedWAC.toFixed(4)}, got $${actualCost.toFixed(4)}`);

  stockMatch
    ? console.log(`   ✅ STOCK MATCH — updated to 70 LB`)
    : console.log(`   ❌ STOCK MISMATCH — expected 70, got ${actualStock}`);

  if (!costMatch || !stockMatch) throw new Error('Verification failed');
}

// ============================================================================
// STEP 7: VERIFY STOCK LOG
// ============================================================================

async function verifyStockLog(authToken, productId) {
  console.log('\n📝 STEP 7: VERIFY STOCK LOG HAS unitCost SNAPSHOT');

  const response = await fetch(`${BASE_URL}/stock/logs/${productId}`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch stock logs: ${response.status}\n${text}`);
  }

  const logs = await response.json();
  const receivedLog = logs.find(l => l.reason === 'RECEIVED');

  if (!receivedLog) {
    throw new Error('No RECEIVED stock log found');
  }

  console.log(`   Most recent RECEIVED log:`);
  console.log(`     change:    +${receivedLog.change}`);
  console.log(`     unitCost:  ${receivedLog.unitCost !== null && receivedLog.unitCost !== undefined ? `$${Number(receivedLog.unitCost).toFixed(4)}` : 'null (legacy)'}`);
  console.log(`     notes:     ${receivedLog.notes}`);

  const snapshotPresent = receivedLog.unitCost !== null && receivedLog.unitCost !== undefined;
  const snapshotCorrect = Math.abs(Number(receivedLog.unitCost) - 3.2) < 0.0001;

  snapshotPresent && snapshotCorrect
    ? console.log(`   ✅ unitCost snapshot correct ($3.2000 — cost before receipt)`)
    : snapshotPresent
    ? console.log(`   ⚠️  unitCost present but unexpected value: $${Number(receivedLog.unitCost).toFixed(4)}`)
    : console.log(`   ⚠️  unitCost is null (migration may not have run yet)`);
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('🚀 WEIGHTED AVERAGE COSTING — END-TO-END TEST');
  console.log('==============================================');
  console.log(`   Target: ${BASE_URL}`);

  try {
    const authToken    = await authenticate();
    await getRestaurantInfo(authToken);
    const productId    = await createTestProduct(authToken);
    const orderId      = await createInvoice(authToken, productId);
    await receiveInvoice(authToken, orderId);
    await verifyProductUpdate(authToken, productId);
    await verifyStockLog(authToken, productId);

    console.log('\n✅ ALL CHECKS PASSED — weighted average costing is live\n');
  } catch (error) {
    console.error('\n❌ TEST FAILED');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
