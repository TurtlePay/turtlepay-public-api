// Copyright (c) 2018-2019, TurtlePay Developers
//
// Please see the included LICENSE file for more information.

'use strict'

require('colors')
const Config = require('../config.json')
const Logger = require('./logger')
const request = require('request-promise-native')
const TurtleCoinUtils = require('turtlecoin-utils').CryptoNote
const util = require('util')

const cryptoUtils = new TurtleCoinUtils()

class Helpers {
  static requestIp (request) {
    return request.header('x-forwarded-for') || request.ip
  }

  static requestUserAgent (request) {
    const agent = request.header('user-agent') || 'unknown'
    return agent.split(' ', 1).join(' ')
  }

  static toNumber (term) {
    if (typeof term === 'number') return term

    if (parseInt(term).toString() === term) return parseInt(term)

    return false
  }

  static logHTTPRequest (req, params, time) {
    params = params || ''
    if (!time && Array.isArray(params) && params.length === 2 && !isNaN(params[0]) && !isNaN(params[1])) {
      time = params
      params = ''
    }
    if (Array.isArray(time) && time.length === 2) {
      time = util.format('%s.%s', time[0], time[1])
      time = parseFloat(time)
      if (isNaN(time)) time = 0
      time = util.format(' [%ss]', time.toFixed(4).padStart(8, ' '))
    } else {
      time = ''
    }
    Logger.info('[REQUEST]%s [%s] (%s) %s %s', time, Helpers.requestIp(req).padStart(15, ' '), Helpers.requestUserAgent(req), req.path, params)
  }

  static logHTTPError (req, message, time) {
    if (Array.isArray(time) && time.length === 2) {
      time = util.format('%s.%s', time[0], time[1])
      time = parseFloat(time)
      if (isNaN(time)) time = 0
      time = util.format(' [%ss]', time.toFixed(4).padStart(8, ' '))
    } else {
      time = ''
    }
    message = message || 'Parsing error'
    Logger.error('[REQUEST]%s [%s] (%s) %s: %s', time, Helpers.requestIp(req).padStart(15, ' '), Helpers.requestUserAgent(req), req.path, message)
  }

  static get Processor () {
    return Processor
  }

  static networkHeight () {
    return request({
      url: util.format('%s/height', Config.nodeURL),
      json: true
    })
      .then(response => { return response.network_height })
  }
}

class Processor {
  static process (rabbit, queue, validationResult) {
    const walletRequest = {
      amount: validationResult.atomicAmount,
      address: validationResult.address,
      confirmations: validationResult.requestConfirmations,
      callback: validationResult.callback,
      callerData: validationResult.callerData,
      fee: validationResult.fee
    }

    return rabbit.requestReply(queue, walletRequest)
      .then(response => {
        return {
          logMessage: JSON.stringify(walletRequest),
          response: {
            sendToAddress: response.address,
            atomicAmount: validationResult.atomicAmount,
            amount: validationResult.amount,
            fee: validationResult.fee,
            userDefined: validationResult.callerData,
            startHeight: response.scanHeight,
            endHeight: response.maxHeight,
            confirmations: validationResult.requestConfirmations,
            callbackPublicKey: response.publicKey,
            qrCode: 'https://chart.googleapis.com/chart?cht=qr&chs=256x256&chl=' + Config.coinUri + '://' + response.address + '?amount=' + validationResult.atomicAmount + ((validationResult.name) ? '&name=' + encodeURIComponent(validationResult.name) : '')
          }
        }
      })
  }

  static validate (request) {
    const atomicAmount = Helpers.toNumber(request.body.amount)
    const callback = request.body.callback || false
    const address = request.body.address || false
    const name = request.body.name || false
    const callerData = request.body.userDefined || {}
    const confirmations = Helpers.toNumber(request.body.confirmations)
    const transactionFee = Helpers.toNumber(request.body.fee)

    return new Promise((resolve, reject) => {
      if (!atomicAmount || atomicAmount === 0 || atomicAmount < 0) return reject(new Error('Invalid amount supplied'))

      const amount = (atomicAmount / Math.pow(10, Config.coinDecimals))

      try {
        cryptoUtils.decodeAddress(address)
      } catch (e) {
        return reject(new Error('Invalid address supplied'))
      }

      if (callback && callback.substring(0, 4).toLowerCase() !== 'http') return reject(new Error('Invalid callback URL supplied'))

      if (confirmations && (confirmations < 0 || confirmations > Config.maximumConfirmations)) return reject(new Error('Invalid confirmations requested'))

      if (transactionFee && transactionFee < Config.minimumNetworkTransactionFee) return reject(new Error('Invalid transaction fee specified. Not enough'))

      if (transactionFee && transactionFee > atomicAmount) return reject(new Error('Invalid transaction fee specified. Too many'))

      const fee = transactionFee || Config.minimumNetworkTransactionFee

      const requestConfirmations = confirmations || Config.defaultConfirmations

      return resolve({
        atomicAmount,
        amount,
        callback,
        address,
        name,
        callerData,
        requestConfirmations,
        fee
      })
    })
  }
}

module.exports = Helpers
