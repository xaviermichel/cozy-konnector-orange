const moment = require('moment')

const { log, BaseKonnector, saveBills, request } = require('cozy-konnector-libs')

let rq = request({
  // debug: true,
  jar: true
})

module.exports = new BaseKonnector(function fetch (fields) {
  return logIn(fields)
  .then(parsePage)
  .then(entries => saveBills(entries, fields.folderPath, {
    timeout: Date.now() + 60 * 1000,
    identifiers: ['orange'],
    dateDelta: 12,
    amountDelta: 5
  }))
})

// Layer to login to Orange website.
function logIn (fields) {
  // Get cookies from login page.
  log('info', 'Get login form')
  return rq('https://id.orange.fr/auth_user/bin/auth_user.cgi')
  // Log in orange.fr
  .then(() => rq({
    method: 'POST',
    url: 'https://id.orange.fr/auth_user/bin/auth_user.cgi',
    form: {
      credential: fields.login,
      password: fields.password
    }
  }))
  .then(body => {
    if (body.credential != null || body.password != null) {
      throw new Error(body.credential || body.password)
    }
  })
  .catch(err => {
    log('error', 'Error while trying to login')
    log('error', err)
    this.terminate('LOGIN_FAILED')
  })
  .then(() => {
    rq = request({
      json: false,
      cheerio: true,
      jar: true
    })
    return rq('https://m.espaceclientv3.orange.fr/?page=factures-archives')
  })
}

// Layer to parse the fetched page to extract bill data.
function parsePage ($) {
  const entries = []

  // Anaylyze bill listing table.
  log('info', 'Parsing bill pages')
  $('ul.factures li').each(function () {
    let firstCell = $(this).find('span.date')
    let secondCell = $(this).find('span.montant')
    let thirdCell = $(this).find('span.telecharger')

    // Add a new bill information object.
    const date = moment(firstCell.html(), 'DD/MM/YYYY')
    let bill = {
      date: date.toDate(),
      amount: parseFloat(secondCell.html().replace(' €', '').replace(',', '.')),
      fileurl: thirdCell.find('a').attr('href'),
      filename: getFileName(date),
      type: 'phone',
      vendor: 'Orange'
    }

    if (bill.date != null && bill.amount != null) {
      entries.push(bill)
    }
  })

  log('info', `Bill retrieved: ${entries.length} found`)
  return entries
}

function getFileName (date) {
  return `${date.format('YYYYMM')}_orange.pdf`
}
