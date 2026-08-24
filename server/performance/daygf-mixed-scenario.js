import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const input = JSON.parse(open(__ENV.NOVATEST_INPUT_FILE));
const scenario = input.asset.config;
const baseUrl = scenario.baseUrl.replace(/\/$/, '');
const accounts = input.accounts;
const postIds = scenario.dataset.postIds;
const historyContentIds = scenario.dataset.historyContentIds;

const loginSuccess = new Rate('novatest_login_success');
const readSuccess = new Rate('novatest_read_success');
const writeSuccess = new Rate('novatest_write_success');
const serverErrors = new Rate('novatest_server_errors');
const requests = new Counter('novatest_requests');
const requestDuration = new Trend('novatest_request_duration', true);
let token;
const likedPosts = new Set();

export const options = {
  stages: scenario.stages.map((stage) => ({ target: stage.vus, duration: `${stage.durationSeconds}s` })),
  thresholds: {
    novatest_login_success: [`rate>=${scenario.thresholds.loginSuccessRate}`],
    novatest_read_success: [`rate>=${scenario.thresholds.readSuccessRate}`],
    novatest_write_success: [`rate>=${scenario.thresholds.writeSuccessRate}`],
    novatest_server_errors: [`rate<${scenario.thresholds.serverErrorRate}`],
    novatest_request_duration: [`p(95)<=${scenario.thresholds.readP95Ms}`]
  },
  discardResponseBodies: true
};

function headers() {
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    ...(token ? { 'x-token': token, authorization: `Bearer ${token}` } : {})
  };
}

function record(response, metric, name) {
  const success = response.status >= 200 && response.status < 300;
  check(response, { [`${name} returns 2xx`]: () => success });
  metric.add(success);
  serverErrors.add(response.status >= 500);
  requests.add(1);
  requestDuration.add(response.timings.duration);
  return success;
}

function login(account) {
  const response = http.post(`${baseUrl}/api/login`, JSON.stringify(account), { headers: headers(), tags: { operation: 'login' } });
  const success = record(response, loginSuccess, 'login');
  if (success) {
    try { token = response.json('token'); } catch { token = undefined; }
    loginSuccess.add(Boolean(token));
  }
  return Boolean(token);
}

function choose(items) {
  return items[Math.floor(Math.random() * items.length)];
}

export default function () {
  const account = accounts[(__VU - 1) % accounts.length];
  if (!token && !login(account)) return sleep(1);

  const roll = Math.random();
  if (roll < 0.35) {
    record(http.get(`${baseUrl}/api/feed/list?page=1&pageSize=20`, { headers: headers(), tags: { operation: 'feed-list' } }), readSuccess, 'feed list');
  } else if (roll < 0.70) {
    record(http.get(`${baseUrl}/api/post/${choose(postIds)}`, { headers: headers(), tags: { operation: 'post-detail' } }), readSuccess, 'post detail');
  } else if (roll < 0.80) {
    record(http.post(`${baseUrl}/api/profile/history`, JSON.stringify({ contentId: choose(historyContentIds) }), { headers: headers(), tags: { operation: 'history' } }), writeSuccess, 'history');
  } else {
    const postId = choose(postIds);
    if (!likedPosts.has(postId)) {
      const success = record(http.post(`${baseUrl}/api/post/${postId}/interaction`, JSON.stringify({ type: 'like' }), { headers: headers(), tags: { operation: 'like' } }), writeSuccess, 'like');
      if (success) likedPosts.add(postId);
    }
  }
  sleep(0.2);
}
