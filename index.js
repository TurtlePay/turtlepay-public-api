// Copyright (c) 2018-2019, TurtlePay Developers
//
// Please see the included LICENSE file for more information.

'use strict'

require('dotenv').config()
const AES = require('./lib/aes.js')
const BodyParser = require('body-parser')
const Compression = require('compression')
const Config = require('./config.json')
const DatabaseBackend = require('./lib/databaseBackend')
const Express = require('express')
const Helmet = require('helmet')
const Helpers = require('./lib/helpers')
const Logger = require('./lib/logger')
const RabbitMQ = require('./lib/rabbit')

const walletQueue = 'request.wallet'

if (!process.env.NODE_ENV || process.env.NODE_ENV.toLowerCase() !== 'production') {
  Logger.warning('Node.js is not running in production mode. Consider running in production mode: export NODE_ENV=production')
}

const crypto = new AES({ password: process.env.BUTTON_CONTAINER_PASSWORD || '' })

const rabbit = new RabbitMQ(
  process.env.RABBIT_PUBLIC_SERVER || 'localhost',
  process.env.RABBIT_PUBLIC_USERNAME || '',
  process.env.RABBIT_PUBLIC_PASSWORD || '',
  true
)

rabbit.on('log', log => {
  Logger.log('[RABBIT] %s', log)
})

rabbit.on('connect', () => {
  Logger.log('[RABBIT] connected to server at %s', process.env.RABBIT_PUBLIC_SERVER || 'localhost')
})

rabbit.on('disconnect', (error) => {
  Logger.error('[RABBIT] lost connected to server: %s', error.toString())
})

/* Set up our database connection */
const database = new DatabaseBackend({
  host: Config.mysql.host,
  port: Config.mysql.port,
  username: Config.mysql.username,
  password: Config.mysql.password,
  database: Config.mysql.database,
  connectionLimit: Config.mysql.connectionLimit
})

Logger.log('Connected to database backend at %s:%s', database.host, database.port)

const app = Express()

/* Automatically decode JSON input from client requestuests */
app.use(BodyParser.json())

/* Catch body-parser errors */
app.use((err, request, response, next) => {
  if (err instanceof SyntaxError) {
    return response.status(400).send()
  }
  next()
})

/* Set up a few of our headers to make this API more functional */
app.use((request, response, next) => {
  response.header('X-requestuested-With', '*')
  response.header('Access-Control-Allow-Origin', Config.corsHeader)
  response.header('Access-Control-Allow-Headers', 'Origin, X-requestuested-With, Content-Type, Accept')
  response.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
  response.header('Cache-Control', 'max-age=30, public')
  next()
})

/* Set up our system to use Helmet */
app.use(Helmet())

/* Last but certainly not least, enable compression because we're going to need it */
app.use(Compression())

/* This is the meat and potatoes entry method for the public API
   aka, submitting a new requestuest for funds to the processing engine */
app.post('/v1/new', (request, response) => {
  const start = process.hrtime()

  return Helpers.Processor.validate(request)
    .then(validation => {
      return Helpers.Processor.process(rabbit, walletQueue, validation)
    })
    .then(result => {
      Helpers.logHTTPRequest(request, result.logMessage, process.hrtime(start))

      return response.json(result.response)
    })
    .catch(error => {
      Helpers.logHTTPError(request, error.toString(), process.hrtime(start))

      const code = (error.toString().toLowerCase().indexOf('invalid') !== -1) ? 400 : 500

      return response.status(code).send()
    })
})

app.post('/v1/button', (request, response) => {
  const start = process.hrtime()

  const encryptedButtonPayload = request.body.buttonPayload || false
  const callerData = request.body.userDefined || {}

  if (!encryptedButtonPayload) {
    Helpers.logHTTPError(request, 'No button payload provided', process.hrtime(start))

    return response.status(400).send()
  }

  /* Try to decrypt the data from the button payload */
  const validationresponse = crypto.decrypt(encryptedButtonPayload)

  Promise.resolve(validationresponse)
    .then(validation => {
      if (!validation) throw new Error('Invalid button payload provided')

      Object.assign(validation.callerData, callerData)

      return Helpers.Processor.process(rabbit, walletQueue, validation)
    })
    .then(result => {
      Helpers.logHTTPRequest(request, result.logMessage, process.hrtime(start))

      return response.json(result.response)
    })
    .catch(error => {
      const code = (error.toString().toLowerCase().indexOf('invalid') !== -1) ? 400 : 500

      return response.status(code).send()
    })
})

app.post('/v1/button/new', (request, response) => {
  const start = process.hrtime()

  return Helpers.Processor.validate(request)
    .then(validation => {
      const buttonPayload = crypto.encrypt(validation)

      Helpers.logHTTPRequest(request, JSON.stringify(validation), process.hrtime(start))

      return response.json({ buttonPayload })
    })
    .catch(error => {
      Helpers.logHTTPError(request, error.toString(), process.hrtime(start))

      const code = (error.toString().toLowerCase().indexOf('invalid') !== -1) ? 400 : 500

      return response.status(code).send()
    })
})

/* response to options requestuests for preflights */
app.options('*', (request, response) => {
  return response.status(200).send()
})

/* This is our catch all to return a 404-error */
app.all('*', (request, response) => {
  const start = process.hrtime()

  Helpers.logHTTPError(request, 'Requested URL not Found (404)', process.hrtime(start))

  return response.status(404).send()
})

rabbit.connect()
  .then(() => {
    app.listen(Config.httpPort, Config.bindIp, () => {
      Logger.log('HTTP server started on %s:%s', Config.bindIp, Config.httpPort)
    })
  })
  .catch(error => {
    Logger.log('Error in rabbit connection: %s', error.toString())
    process.exit(1)
  })
