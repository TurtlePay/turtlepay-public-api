// Copyright (c) 2018-2019, TurtlePay Developers
//
// Please see the included LICENSE file for more information.

'use strict'

const MySQL = require('mysql')

class DatabaseBackend {
  constructor (opts) {
    opts = opts || {}
    this.host = opts.host || '127.0.0.1'
    this.port = opts.port || 3306
    this.username = opts.username || ''
    this.password = opts.password || ''
    this.database = opts.database || ''
    this.socketPath = opts.socketPath || false
    this.connectionLimit = opts.connectionLimit || 10

    this.db = MySQL.createPool({
      connectionLimit: this.connectionLimit,
      host: this.host,
      port: this.port,
      user: this.username,
      password: this.password,
      database: this.database,
      socketPath: this.socketPath
    })
  }

  query (query, args) {
    return new Promise((resolve, reject) => {
      this.db.query(query, args, (error, results, fields) => {
        if (error) return reject(error)
        return resolve(results)
      })
    })
  }
}

module.exports = DatabaseBackend
