import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { randomIntBetween, uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// Get users from JSON file
const users = JSON.parse(open('./data/credentials.json')).users;

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
            executor: 'shared-iterations',
            vus: 5,
            iterations: 5,
            exec: 'register',
        },

        // 2. User Login and Purchase Scenario
        login_and_create: {
            executor: 'constant-arrival-rate',
            rate: 5,                // 5 iterations per second
            timeUnit: '1s',         // time unit is second
            duration: '30s',        // run for 20 seconds
            preAllocatedVUs: 10,    // simulate 10 concurrent users
            exec: 'loginAndCreate',
        },
    },
};

const BASE_URL = 'https://api.escuelajs.co/api/v1';
const headers = { 'Content-Type': 'application/json' };

/* ---------------- 1. REGISTER SCENARIO ---------------- */
export function register() {
    const name = 'userK6_' + randomIntBetween(1, 999);
    const email = name + '@mailinator.com';
    const password = '123456';
    const role = 'customer';
    const avatar = 'https://picsum.photos/800';


    const res = http.post(`${BASE_URL}/users`, JSON.stringify(
        {
            name: name,
            email: email,
            password: password,
            role: role,
            avatar: avatar,
        }),
        { headers: headers, }
    );

    check(res, {
        'add user successful': r => r.status === 201,
    });

    sleep(1);
}

/* ---------------- 2. LOGIN AND CREATE SCENARIO ---------------- */
export function loginAndCreate() {

    // LOGIN
    // 2. Random select a user
    const user = users[(__VU - 1) % users.length];
    const email = user.email;
    const password = user.password;

    const resLogin = http.post(`${BASE_URL}/auth/login`, JSON.stringify(
        {
            email: email,
            password: password,
        }),
        { headers: headers, }
    );

    console.log('LOGIN:' + email + ' / ' + password + ' / ' + `LOGIN RESPONSE: ${resLogin.body}`);

    check(resLogin, {
        'login successful': (r) => r.status === 201,
        'token received': (r) => r.json('access_token') !== undefined,
    });

    sleep(1);

    // 3. Extract Auth token from login response as json, fallback to regex
    let token;
    try {
        token = resLogin.json('access_token');
    } catch (e) { }

    console.log(`TOKEN: ${token}`);

    if (!token) {
        console.error(`Login failed for ${email} - no auth token`);
        return;
    }

    // CREATE A NEW CATEGORY

    const categoryName = `Test Category_${uuidv4()}`;
    const categoryImage = `https://picsum.photos/800`;

    const categoryRes = http.post(`${BASE_URL}/categories`, JSON.stringify(
        {
            name: categoryName,
            image: categoryImage,
        }),
        {
            headers: headers,
            Authorization: `Bearer ${token}`,
        }

    );

    console.log(`CATEGORY RESPONSE: ${categoryRes.body}`);

    check(categoryRes, {
        'create product successful': r => r.status === 201 && r.body.includes(categoryName),
    });

    sleep(1);
}
