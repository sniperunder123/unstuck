const test = require('node:test')
const assert = require('node:assert')
const { total } = require('./cart')

test('total rounds to the cent', () => {
  assert.strictEqual(total([{ price: 19.99, qty: 3 }]), 59.97)
})

test('total of an empty cart is 0', () => {
  assert.strictEqual(total([]), 0)
})
