let cozydb = require('cozydb');
let request = require('request');
let moment = require('moment');
let cheerio = require('cheerio');

let fetcher = require('../lib/fetcher');
let filterExisting = require('../lib/filter_existing');
let saveDataAndFile = require('../lib/save_data_and_file');
let linkBankOperation = require('../lib/link_bank_operation');

let localization = require('../lib/localization_manager');

let log = require('printit')({
    prefix: "Orange",
    date: true
});


// Models

let Bill = require('../models/bill');


// Konnector

module.exports = {

    name: "Orange",
    slug: "orange",
    description: 'konnector description orange',
    vendorLink: "https://www.orange.fr/",

    category: 'telecom',
    color: {
        hex: '#FF6122',
        css: '#FF6122'
    },

    fields: {
        login: {
            type: "text"
        },
        password: {
            type: "password"
        },
        folderPath: {
            type: "folder",
            advanced: true
        }
    },

    dataType: [
        'bill'
    ],

    models: {
        bill: Bill
    },

    // Define model requests.
    init(callback) {
        // Nothing to do here.
        return callback();
    },

    fetch(requiredFields, callback) {
        log.info("Import started");

        return fetcher.new()
            .use(logIn)
            .use(parsePage)
            .use(filterExisting(log, Bill))
            .use(saveDataAndFile(log, Bill, 'orange', ['bill']))
            .use(linkBankOperation({
                log,
                model: Bill,
                identifier: 'orange',
                dateDelta: 12,
                amountDelta: 5
            }))
            .args(requiredFields, {}, {})
            .fetch(function(err, fields, entries) {
                log.info("Import finished");

                let notifContent = null;
                if (__guard__(entries != null ? entries.filtered : undefined, x => x.length) > 0) {
                    let localizationKey = 'notification orange';
                    let options = {smart_count: entries.filtered.length};
                    notifContent = localization.t(localizationKey, options);
                }

                return callback(err, notifContent);
        });
    }
};


// Layer to login to Orange website.
var logIn = function(requiredFields, billInfos, data, next) {

    let logInOptions = {
        method: 'GET',
        jar: true,
        url: "https://id.orange.fr/auth_user/bin/auth_user.cgi"
    };

    let signInOptions = {
        method: 'POST',
        jar: true,
        url: "https://id.orange.fr/auth_user/bin/auth_user.cgi",
        form: {
            'credential': requiredFields.login,
            'password': requiredFields.password
        }
    };

    let billOptions = {
        method: 'GET',
        jar: true,
        url: "https://m.espaceclientv3.orange.fr/?page=factures-archives"
    };


    log.info('Get login form');
    // Get cookies from login page.
    return request(logInOptions, function(err, res, body) {
        if (err) {
            log.info(err);
            return next('request error');
        }

        // Log in orange.fr
        log.info('Logging in');
        return request(signInOptions, function(err, res, body) {
            let error;
            if (err) {
                log.error('Login failed');
                log.raw(err);
                return next('request error');
            }

            let response = JSON.parse(body);
            if ((response.credential != null) || (response.password != null)) {
                error = (response.credential != null) ? response.credential
                : response.password;
                log.info(error);
                next('bad credentials');
            }

            // Download bill information page.
            log.info('Fetch bill info');
            return request(billOptions, function(err, res, body) {
                if (err) {
                    log.error('An error occured while fetching bills');
                    console.log(err);
                    return next('request error');
                }

                log.info('Fetch bill info succeeded');
                data.html = body;
                return next();
            });
        });
    });
};


// Layer to parse the fetched page to extract bill data.
var parsePage = function(requiredFields, bills, data, next) {
    bills.fetched = [];
    let $ = cheerio.load(data.html);

    // Anaylyze bill listing table.
    log.info('Parsing bill pages');
    $('ul.factures li').each(function() {

        let firstCell = $(this).find('span.date');
        let secondCell = $(this).find('span.montant');
        let thirdCell = $(this).find('span.telecharger');

        // Add a new bill information object.
        let bill = {
            date: moment(firstCell.html(), 'DD/MM/YYYY'),
            amount: parseFloat(secondCell
                .html()
                .replace(' €', '')
                .replace(',', '.')
            ),
            pdfurl: thirdCell.find('a').attr('href'),
            type: 'phone',
            vendor: 'Orange'
        };

        if ((bill.date != null) && (bill.amount != null)) { return bills.fetched.push(bill); }
    });

    log.info(`Bill retrieved: ${bills.fetched.length} found`);
    return next();
};

function __guard__(value, transform) {
  return (typeof value !== 'undefined' && value !== null) ? transform(value) : undefined;
}