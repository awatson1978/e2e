// This is a custom Mocha interface based on Mocha's own
// BDD interface (node_modules/mocha/lib/interfaces/bdd.js).
// Mocha's original implementation is copied here and all
// we're doing is wrapping a few methods like `it`, `before`
// and `after` so their callbacks run inside fibers.

/**
 * Module dependencies.
 */

var Fiber = require('fibers');
var Suite = require('mocha/lib/suite');
var Test = require('mocha/lib/test');
var escapeRe = require('mocha/node_modules/escape-string-regexp');
var path = require('path');
var fs = require('fs');
var bdd = require('mocha/lib/interfaces/bdd.js');
var _ = require('underscore');

// Takes a screenshot of the current state of the test run
// and saves it to a file.
// XXX really shouldn't be in this file.
var screenshot = function () {
  var filename = _.random(100000, 999999) + ".png";
  if (process.env.SCREENSHOT_FILENAME_PREFIX)
    filename = process.env.SCREENSHOT_FILENAME_PREFIX + filename;

  var dir = "screenshots";
  var relPath = path.join(dir, filename);
  var tmpFile = path.resolve(process.cwd(), relPath);

  if (!fs.existsSync("screenshots")) {
    fs.mkdirSync("screenshots");
  } else {
    if (!fs.statSync("screenshots").isDirectory()) {
      throw new Error("Unexpected: screenshot/ exists but is not a directory");
    }
  }

  fs.writeFileSync(
    tmpFile,
    new Buffer(browser.takeScreenshot(), 'base64'));

  var screenshotLocator;
  if (process.env.JENKINS_URL) {
    // if running in Jenkins, which publishes to S3
    screenshotLocator = "http://s3.amazonaws.com/com.meteor.jenkins/e2e-screenshots/" + filename;
  } else {
    screenshotLocator = tmpFile;
  }

  return screenshotLocator;
};

// Report a message to the reported running in the main process that
// will be printed at the bottom of the run in the failure banner
var reportInFailureBanner = function (msg) {
  console.log(JSON.stringify(["failureBanner", msg]));
};

/**
 * Wrap a raw BDD interface method so that its callback
 * runs inside a fiber.
 *
 * @param {Function} original
 */
var wrap = function (original) {
  return function (/* arguments */) {
    var args = [].slice.call(arguments);
    var fn = args[args.length - 1];
    var asyncRE = /^function.*\(\s*done\s*\)\s*\{/;
    var isVanillaAsync = asyncRE.test(fn.toString());
    // If `fn` is a vanilla async function that takes a `done`
    // callback, let the user call `done` instead of here.
    args[args.length - 1] = function (done) {
      Fiber(function () {
        try {
          fn(done);
        } catch (e) {
          reportInFailureBanner(
            "Error: " + e.message);
          reportInFailureBanner(
            "Screenshot at time of failure: " + screenshot());
          reportInFailureBanner(
            "Screencast and Selenium Logs: " + browser.sauceLabsUrl);
          throw e;
        }

        if (! isVanillaAsync)
          done();
      }).run();
    };
    original.apply(null, args);
  };
};

// The interface function exported here gets called by
// mocha when loading its interface internally.
module.exports = function(suite){
  bdd(suite);

  // wrap all functions used to define test steps
  suite.on('pre-require', function (context, file, mocha) {
    [
      'it',
      'before',
      'after',
      'beforeEach',
      'afterEach'
    ].forEach(function (key) {
      context[key] = wrap(context[key]);
    });
  });
};
