const round = n => Math.round(n * 100) / 100

/** Cart total in euros, rounded to the cent. */
function total(items) {
  return round(items.reduce((sum, item) => sum + item.price * item.qty, 0))
}

module.exports = { total }
