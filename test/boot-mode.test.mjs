// 頁面第一次畫出來就要是最終畫面:開機腳本要跟 app.js 的路由判斷一致,不然就會跳。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8')
const boot = /<script id="bootMode">([\s\S]*?)<\/script>/.exec(html)
assert.ok(boot, 'index.html needs the boot script')

function bootFor({ path = '/', width = 1280, user = false, refresh = false }) {
  const classes = new Set(['mode-landing'])
  const store = new Map()
  if (user) store.set('pokkit_user', '{"userId":"u"}')
  if (refresh) store.set('lmu_app_5qXx5Wtv_refresh_token', 'r')
  vm.runInNewContext(boot[1], {
    document: {
      body: {
        classList: {
          add: (c) => classes.add(c),
          remove: (c) => classes.delete(c),
          toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
        },
      },
    },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null) },
    location: { pathname: path },
    matchMedia: (q) => ({ matches: width >= Number(/(\d+)px/.exec(q)[1]) }),
  })
  return {
    mode: classes.has('mode-dashboard') ? 'dashboard' : 'landing',
    guest: classes.has('is-guest'),
  }
}

test('a guest on desktop starts on the landing page', () => {
  assert.deepEqual(bootFor({}), { mode: 'landing', guest: true })
})

test('a guest on a phone starts on the landing page', () => {
  assert.deepEqual(bootFor({ width: 390 }), { mode: 'landing', guest: true })
})

test('a member on desktop starts in the dashboard, with no landing flash', () => {
  assert.deepEqual(bootFor({ user: true, refresh: true }), { mode: 'dashboard', guest: false })
})

test('a member on a phone keeps the landing page, matching the router', () => {
  assert.deepEqual(bootFor({ user: true, refresh: true, width: 390 }), { mode: 'landing', guest: false })
})

test('a cached name with no session left is a guest', () => {
  assert.deepEqual(bootFor({ user: true }), { mode: 'landing', guest: true })
})

test('deep links start in the dashboard shell for everyone', () => {
  assert.deepEqual(bootFor({ path: '/pricing' }), { mode: 'dashboard', guest: true })
  assert.equal(bootFor({ path: '/folders', user: true, refresh: true, width: 390 }).mode, 'dashboard')
})

test('an unknown path is treated as home', () => {
  assert.equal(bootFor({ path: '/nope' }).mode, 'landing')
})

test('the boot route list stays in sync with the router', () => {
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8')
  const router = /var DASH_ROUTES = (\[[^\]]+\]);/.exec(app)[1]
  assert.ok(boot[1].includes(router), `boot script must list ${router}`)
})

test('the router sends guests to the landing page on any width', () => {
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8')
  const home = app.slice(app.indexOf("if (route === 'home') {"), app.indexOf('// Dashboard pages'))
  assert.match(home, /if \(currentUser && window\.matchMedia\('\(min-width: 761px\)'\)\.matches\)/)
})

test('translations load before the page body so Chinese users never see English first', () => {
  assert.ok(html.indexOf('/i18n.js') < html.indexOf('<body'), 'i18n.js must be in the head')
})

test('logging out brings the upload area back on the landing page', () => {
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8')
  const fn = app.slice(app.indexOf('function applyLoggedOut() {'), app.indexOf("$logoutBtn.addEventListener('click'"))
  assert.match(fn, /setMode\(false\);[\s\S]*toggleUploadZone\(true\);/)
})
