/**
 * publish-release
 * Create GitHub releases with assets
 *
 * @author Zach Bruggeman <mail@bruggie.com>
 */

var request = require('request')
var async = require('async')
var mime = require('mime')
var progress = require('progress-stream')
var util = require('util')
var fs = require('fs')
var path = require('path')
var EventEmitter = require('events').EventEmitter
var pkg = require('./package.json')

var DEFAULT_API_ROOT = 'https://api.github.com'

function PublishRelease (opts, cb) {
  if (!(this instanceof PublishRelease)) return new PublishRelease(opts, cb)

  this.opts = (opts || {})
  this.cb = (cb || function noop () {})

  this.publish()
}

util.inherits(PublishRelease, EventEmitter)

PublishRelease.prototype.publish = function publish () {
  var self = this
  var opts = this.opts
  var cb = this.cb

  // validate opts
  var missing = []
  ;['token', 'repo', 'owner', 'tag'].forEach(function validateOpts (opt) {
    if (!opts[opt]) {
      missing.push(opt)
    }
  })
  if (missing.length > 0) {
    return cb(new Error('missing required options: ' + missing.join(', ')))
  }

  async.auto({
    createRelease: function createRelease (callback) {
      var ghReleaseUri = util.format((opts.apiUrl || DEFAULT_API_ROOT) + '/repos/%s/%s/releases', opts.owner, opts.repo)

      function requestCreateRelease () {
        self.emit('create-release')
        request({
          uri: ghReleaseUri,
          method: 'POST',
          json: true,
          body: {
            tag_name: opts.tag,
            target_commitish: opts.target_commitish,
            name: opts.name,
            body: opts.notes,
            draft: !!opts.draft,
            prerelease: !!opts.prerelease
          },
          headers: {
            'Authorization': 'token ' + opts.token,
            'User-Agent': 'publish-release ' + pkg.version + ' (https://github.com/remixz/publish-release)'
          }
        }, function (err, res, body) {
          if (err) return callback(err)
          self.emit('created-release')
          callback(null, body)
        })
      }

      if (opts.reuseRelease) {
        request({
          uri: ghReleaseUri,
          method: 'GET',
          json: true,
          headers: {
            'Authorization': 'token ' + opts.token,
            'User-Agent': 'publish-release ' + pkg.version + ' (https://github.com/remixz/publish-release)'
          }
        }, function (err, res, body) {
          if (err) return callback(err)
          if (res.statusCode >= 200 && res.statusCode < 300 && body[0] && body[0].tag_name === opts.tag) {
            self.emit('reuse-release')
            callback(null, body[0])
          } else {
            requestCreateRelease()
          }
        })
      } else {
        requestCreateRelease()
      }
    },

    uploadAssets: ['createRelease', function uploadAssets (callback, obj) {
      if (!opts.assets || opts.assets.length === 0) return callback()
      if (obj.createRelease.errors || !obj.createRelease.upload_url) return callback(obj.createRelease)

      async.eachSeries(opts.assets, function (asset, callback) {
        var fileName = path.basename(asset)
        var uploadUri = obj.createRelease.upload_url.split('{')[0] + '?name=' + fileName
        self.emit('upload-asset', fileName)

        var stat = fs.statSync(asset)
        var rd = fs.createReadStream(asset)
        var us = request({
          method: 'POST',
          uri: uploadUri,
          headers: {
            'Authorization': 'token ' + opts.token,
            'Content-Type': mime.lookup(fileName),
            'Content-Length': stat.size,
            'User-Agent': 'publish-release ' + pkg.version + ' (https://github.com/remixz/publish-release)'
          }
        })

        var prog = progress({
            length: stat.size,
            time: 100
        }, function (p) {
          self.emit('upload-progress', fileName, p)
        })

        rd.on('error', function (err) {
          callback(err)
        })
        us.on('error', function (err) {
          callback(err)
        })

        us.on('end', function () {
          self.emit('uploaded-asset', fileName)
          callback()
        })

        rd.pipe(prog).pipe(us)
      }, function (err) {
        callback(err)
      })
    }]
  }, function (err, obj) {
    if (err) return cb(err)
    cb(null, obj.createRelease)
  })
}

module.exports = PublishRelease
