const moment = require('moment')
const cheerio = require('cheerio')
const request = require('request')

const {
    log,
    baseKonnector,
    filterExisting,
    linkBankOperation,
    saveDataAndFile,
    models
} = require('cozy-konnector-libs')
const Bill = models.bill

// Konnector
module.exports = baseKonnector.createNew({
  name: 'Orange',
  slug: 'orange',
  description: 'konnector description orange',
  vendorLink: 'https://www.orange.fr/',

  category: 'telecom',
  color: {
    hex: '#FF6122',
    css: '#FF6122'
  },

  dataType: ['bill'],

  models: [Bill],

  fetchOperations: [
    logIn,
    parsePage,
    customFilterExisting,
    customSaveDataAndFile,
    customLinkBankOperations
  ]
})

// Layer to login to Orange website.
function logIn (requiredFields, billInfos, data, next) {
  let logInOptions = {
    method: 'GET',
    jar: true,
    url: 'https://id.orange.fr/auth_user/bin/auth_user.cgi'
  }

  let signInOptions = {
    method: 'POST',
    jar: true,
    url: 'https://id.orange.fr/auth_user/bin/auth_user.cgi',
    form: {
      credential: requiredFields.login,
      password: requiredFields.password
    }
  }

  let billOptions = {
    method: 'GET',
    jar: true,
    url: 'https://m.espaceclientv3.orange.fr/?page=factures-archives'
  }

  log('info', 'Get login form')
  // Get cookies from login page.
  request(logInOptions, function (err, res, body) {
    if (err) {
      console.log(err, 'error details after getting the login page')
      return next('LOGIN_FAILED')
    }

    // Log in orange.fr
    log('info', 'Logging in')
    request(signInOptions, function (err, res, body) {
      if (err) {
        console.log(err, 'error details after login')
        return next('LOGIN_FAILED')
      }

      let response = JSON.parse(body)
      if (response.credential != null || response.password != null) {
        let error = response.credential || response.password
        console.log(error, 'error details after login 2')
        return next('LOGIN_FAILED')
      }

      // Download bill information page.
      log('info', 'Fetch bill info')
      request(billOptions, function (err, res, body) {
        if (err) {
          log('error', 'An error occured while fetching bills')
          console.log(err, 'error details after trying to fetch the bills')
          return next('UNKNOWN_ERROR')
        }

        log('info', 'Fetch bill info succeeded')
        data.html = body
        next()
      })
    })
  })
}

// Layer to parse the fetched page to extract bill data.
function parsePage (requiredFields, bills, data, next) {
  bills.fetched = []
  let $ = cheerio.load(data.html)

  // Anaylyze bill listing table.
  log('info', 'Parsing bill pages')
  $('ul.factures li').each(function () {
    let firstCell = $(this).find('span.date')
    let secondCell = $(this).find('span.montant')
    let thirdCell = $(this).find('span.telecharger')

    // Add a new bill information object.
    let bill = {
      date: moment(firstCell.html(), 'DD/MM/YYYY'),
      amount: parseFloat(secondCell.html().replace(' €', '').replace(',', '.')),
      pdfurl: thirdCell.find('a').attr('href'),
      type: 'phone',
      vendor: 'Orange'
    }

    if (bill.date != null && bill.amount != null) {
      bills.fetched.push(bill)
    }
  })

  log('info', `Bill retrieved: ${bills.fetched.length} found`)
  next()
}

function customFilterExisting (requiredFields, entries, data, next) {
  filterExisting(null, Bill)(requiredFields, entries, data, next)
}

function customSaveDataAndFile (requiredFields, entries, data, next) {
  saveDataAndFile(null, Bill, 'orange', ['facture'])(
        requiredFields,
        entries,
        data,
        next
    )
}

function customLinkBankOperations (requiredFields, entries, data, next) {
  linkBankOperation(entries.fetched, 'io.cozy.bills', {
    log,
    model: Bill,
    identifiers: ['orange'],
    dateDelta: 12,
    amountDelta: 5
  })
}
