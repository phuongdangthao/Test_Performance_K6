import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { randomIntBetween, uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

export const options = {
  // Grafana Cloud configuration for k6 Cloud
  cloud: {
    distribution: {
      "amazon:au:sydney": {
        loadZone: "amazon:au:sydney",
        percent: 100,
      },
    },
  },

  //Thresholds
  thresholds: {
    http_req_failed: ['rate<0.02'], // HTTP request failure rate must be less than 2%
    http_req_duration: ['p(95)<5000'],  // 95th percentile of response times should be less than 5000ms
  },

  scenarios: {
    //1. User Registration Scenario
    register_users: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 5 }, // ramp up
        { duration: '1m', target: 5 },  // steady load
        { duration: '10s', target: 0 }, // ramp down
      ],
      exec: 'register',
    },

    // 2. User Login and Purchase Scenario
    login_and_purchase: {
      executor: 'per-vu-iterations',
      vus: 10,
      iterations: 5,
      startTime: '1m20s', // start after register scenario
      exec: 'loginAndPurchase',
    },
  },
};

const BASE_URL = 'https://api.demoblaze.com';
const PRODUCT_PER_USER = 2;
const headers = { 'Content-Type': 'application/json' };
let vuUser;

/* ---------------- 1. REGISTER SCENARIO ---------------- */
export function register() {
  const username = `user_${uuidv4()}`;
  const password = '123456';

  const res = http.post(`${BASE_URL}/signup`, JSON.stringify({ username: username, password: password, }), { headers: headers, });

  check(res, {
    'signup successful': r => r.status === 200,
  });

  sleep(1);
}

/* ---------------- 2. LOGIN AND PURCHASE SCENARIO ---------------- */
export function loginAndPurchase() {
  group('01. Setup (Signup)', function () {
    // Precondition: SIGN UP (ONLY ONCE PER VU - NOT AFFECT RESULT)
    if (!vuUser) {
      const username = `vu_${__VU}_${uuidv4()}`;
      const password = '123456';

      const signupRes = http.post(
        `${BASE_URL}/signup`,
        JSON.stringify({ username, password }),
        {
          headers: headers,
        }
      );

      check(signupRes, {
        'signup successful': r => r.status === 200,
      });

      // cache user for this VU
      vuUser = { username, password };

      sleep(1);
    }

  });

  const { username, password } = vuUser;

  group('02. Business Logic (Login and Purchase)', function () {
    // LOGIN
    // 1. Perform login
    const loginRes = http.post(`${BASE_URL}/login`, JSON.stringify({ username: username, password: password, }),
      {
        headers: headers,
      });
    console.log('LOGIN: Username: ' + username + ' / Password: ' + password + ' / Response: ' + loginRes.body);


    // 2. Check login response
    check(loginRes, {
      'login successful': r => r.status === 200 && r.body.includes('Auth_token'),
    });

    // 3. Extract Auth token from login response as json, fallback to regex
    let authToken;
    try {
      authToken = loginRes.json('Auth_token');
    } catch (e) { }

    if (!authToken) {
      const tokenMatch = loginRes.body.match(/Auth_token:\s*"?([^"\s]+)"?/);
      authToken = tokenMatch ? tokenMatch[1] : null;
    }

    console.log(`AUTH TOKEN: ${authToken}`);

    if (!authToken) {
      console.error(`Login failed for ${username} - no auth token`);
      return;
    }

    sleep(1);

    // GO TO HOME PAGE - PRODUCT LIST
    const listProductsRes = http.get(`${BASE_URL}/entries`);

    check(listProductsRes, { 'load product list': r => r.status === 200 && r.json('Items').length > 0, });

    sleep(1);

    // VIEW PRODUCT DETAIL AND ADD TO CART
    for (let i = 0; i < PRODUCT_PER_USER; i++) {
      // 1. View Product Detail (random product)
      const productId = randomIntBetween(1, 9);
      const productRes = http.post(`${BASE_URL}/view`, JSON.stringify({ id: productId, }), {
        headers: headers,
      });

      check(productRes, { 'load product detail successful': r => r.status === 200 && r.body.length > 0, });

      // 2. Add to Cart
      const cartRes = http.post(`${BASE_URL}/addtocart`, JSON.stringify({
        id: uuidv4(),
        cookie: authToken,
        flag: true,
        prod_id: productId,
      }), {
        headers: headers,
      });
      check(cartRes, { 'add product to cart successful': r => r.status === 200 });

      console.log(`ADDED PRODUCT: ${cartRes.body}`);

      sleep(1);
    }

    // VIEW CART AND PURCHASE (Delete cart)
    //1. View Cart
    const cartRes = http.post(`${BASE_URL}/viewcart`, JSON.stringify({ cookie: authToken, flag: true, }),
      {
        headers: headers,
      });
    console.log('VIEW CART RESPONSE: ' + cartRes.body);

    // 2. Extract Cookie from view cart response
    const cookieViewCart = cartRes.json('Items.0.cookie') || null;

    if (!cookieViewCart) {
      console.error('View cart failed - no cookie');
      return;
    }

    console.log(`COOKIE VIEW CART: ${cookieViewCart}`);

    check(cartRes, {
      'view cart successful': r => r.status === 200 && r.body.includes(cookieViewCart),
    });

    sleep(1);

    // 3. Purchase (Delete Cart)
    const purchaseRes = http.post(`${BASE_URL}/deletecart`, JSON.stringify({ cookie: cookieViewCart, }),
      {
        headers: headers,
      });
    console.log(`PURCHASE RESPONSE: ${purchaseRes.body}`);

    check(purchaseRes, {
      'purchase successful': r => r.status === 200 && r.body.includes('Item deleted.'),
    });

    sleep(1);
  });
}


