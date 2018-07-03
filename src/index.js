// Force sentry DSN into environment variables
// In the future, will be set by the stack
process.env.SENTRY_DSN =
  process.env.SENTRY_DSN ||
  'https://913841dc7a6a44a59bb26b70df222286:34e4ff6001884d0fac9091d4c1fee102@sentry.cozycloud.cc/25'

const moment = require('moment')
moment.locale('fr')

const {
  log,
  BaseKonnector,
  saveBills,
  requestFactory,
  errors,
  retry
} = require('cozy-konnector-libs')

let request = requestFactory({
  // debug: true,
  jar: true
})

module.exports = new BaseKonnector(function fetch(fields) {
  return logIn
    .bind(this)(fields)
    .then(parsePage)
    .then(entries =>
      saveBills(entries, fields.folderPath, {
        timeout: Date.now() + 60 * 1000,
        identifiers: ['orange'],
        dateDelta: 12,
        amountDelta: 5
      })
    )
})

// Layer to login to Orange website.
function logIn(fields) {
  const resolveWithFullResponse = true // FIXME: Doesn't work in requestFactory

  // Get cookies from login page.
  log('info', 'Get login form')
  return (
    request({
      uri: 'https://login.orange.fr/',
      resolveWithFullResponse
    })
      // Log in orange.fr
      .then(response => {
        const headers = {
          'x-auth-id': response.headers['x-auth-id'],
          'x-xsrf-token': response.headers['x-xsrf-token']
        }
        const { login, password } = fields

        log('info', 'Send login with first XSRF token...')
        return request({
          method: 'POST',
          url: 'https://login.orange.fr/front/login',
          headers,
          body: {
            login
          },
          resolveWithFullResponse
        }).then(response => {
          headers['x-xsrf-token'] = response.headers['x-xsrf-token']
          log('info', 'Send password with second XSRF token...')
          return request({
            method: 'POST',
            url: 'https://login.orange.fr/front/password',
            headers,
            body: {
              login,
              password
            }
          })
        })
      })
      .then(body => {
        if (body.credential != null || body.password != null) {
          throw new Error(body.credential || body.password)
        }
      })
      .catch(err => {
        log('error', err)
        if (err && err.message.includes('bloqué')) {
          this.terminate('LOGIN_FAILED.TOO_MANY_ATTEMPTS')
        }
        this.terminate(errors.LOGIN_FAILED)
      })
      .then(() => {
        log('info', 'Successfully logged in.')
        return retry(getHistory, {
          interval: 10000,
          throw_original: true,
          // retry only if we get a timeout error
          predicate: err => {
            const isTimeout = err.cause && err.cause.code === 'ETIMEDOUT'
            if (isTimeout)
              log(
                'info',
                'We go the famous timeout error. Trying multiple times'
              )
            return isTimeout
          }
        })
      })
      .catch(err => {
        const isTimeout = err.cause && err.cause.code === 'ETIMEDOUT'
        if (isTimeout) {
          throw new Error(errors.VENDOR_DOWN)
        } else {
          throw err
        }
      })
      .then($ => {
        // if multiple contracts choices, choose the first one
        const contractChoices = $('.ec-contractPanel-description a')
          .map(function(index, elem) {
            const $elem = $(elem)
            return {
              link: $elem.attr('href'),
              text: $elem.text()
            }
          })
          .get()
          .filter(
            value =>
              value.text.includes('Livebox') || value.text.includes('Orange')
          )
        if (contractChoices.length) {
          // take the first orange contract at the moment
          return request(
            `https://espaceclientv3.orange.fr/${contractChoices[0].link}`
          )
        } else return $
      })
  )
}

// Layer to parse the fetched page to extract bill data.
function parsePage($) {
  const entries = []

  // Anaylyze bill listing table.
  log('info', 'Parsing bill pages')
  $('table tbody tr').each(function() {
    let date = $(this)
      .find('td[headers=ec-dateCol]')
      .text()
    date = moment(date, 'LL')
    let amount = $(this)
      .find('td[headers=ec-amountCol]')
      .text()
    amount = parseFloat(
      amount
        .trim()
        .replace(' €', '')
        .replace(',', '.')
    )
    let fileurl = $(this)
      .find('td[headers=ec-downloadCol] a')
      .attr('href')

    // Add a new bill information object.
    let bill = {
      date: date.toDate(),
      amount,
      fileurl,
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

function getFileName(date) {
  return `${date.format('YYYYMM')}_orange.pdf`
}

function getHistory() {
  request = requestFactory({
    json: false,
    cheerio: true,
    jar: true
  })
  return request({
    url: 'https://espaceclientv3.orange.fr/?page=factures-historique',
    timeout: 5000
  })
}
