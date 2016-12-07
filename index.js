'use strict';
var path = require('path');
var fs = require('fs-path');
var glob = require('glob');
var AxeBuilder = require('axe-webdriverjs');
var WebDriver = require('selenium-webdriver');
var Promise = require('promise');
var fileUrl = require('file-url');
var reporter = require('./lib/reporter');
var chalk = require('chalk');
var request = require('then-request');
require('chromedriver');

//setup custom phantomJS capability
var phantomjs_exe = require('phantomjs-prebuilt').path;
var customPhantom = WebDriver.Capabilities.phantomjs().set('phantomjs.binary.path', phantomjs_exe);

module.exports = function (customOptions, done) {

	var defaultOptions = {
		folderOutputReport: 'aXeReports',
		browser: 'chrome',
		showOnlyViolations: false,
		verbose: false,
		saveOutputIn: '',
		tags: null,
		urls: [],
		threshold: 0
	};

	var options = customOptions ? Object.assign(defaultOptions, customOptions) : defaultOptions;
	var driver = options.browser === 'phantomjs' ? new WebDriver.Builder().withCapabilities(customPhantom).build() : new WebDriver.Builder().forBrowser(options.browser).build();
	var tagsAreDefined = (!Array.isArray(options.tags) && options.tags !== null && options.tags !== '') || (Array.isArray(options.tags) && options.tags.length > 0);

	var isRemoteUrl = function (url) {
		return url.indexOf('http://') >= 0 || url.indexOf('https://') >= 0;
	};

	var flatten = function (arr) {
		return [].concat.apply([], arr);
	};

	var getUrl = function (url) {
		return isRemoteUrl(url) ? url : fileUrl(url);
	}

	var checkNotValidUrls = function (result) {
		return new Promise(function (resolve) {
			request('GET', result.url, function (error, response) {
				result.status = (error) ? 404 : 200;
				resolve(result);
			});
		});
	}

	var getRemoteUrls = function (result) {
		if (isRemoteUrl(result.url)) {
			return result;
		}
	};

	var getLocalUrls = function (result) {
		if (!isRemoteUrl(result.url)) {
			return result;
		}
	};

	var onlyViolations = function (item) {
		return item.violations.length > 0;
	};

	var removePassesValues = function (item) {
		delete item.passes;
		return item;
	};

	var mergeArray = function (coll, item) {
		coll.push(item);
		return coll;
	};

	var createResults = function (results) {
		var dest = '';
		var localUrls = results.filter(getLocalUrls);
		var remoteUrls = results.filter(getRemoteUrls);
		var promises = remoteUrls.map(checkNotValidUrls);
		var resultsForReporter;
		Promise.all(promises).then(function (results) {
			resultsForReporter = localUrls.reduce(mergeArray, results);
			if (options.showOnlyViolations) {
				resultsForReporter = resultsForReporter.map(removePassesValues).filter(onlyViolations);
			}
			if (options.saveOutputIn !== '') {
				dest = path.join(options.folderOutputReport, options.saveOutputIn);
				fs.writeFileSync(dest, JSON.stringify(resultsForReporter, null, '  '));
			}
			if (options.verbose) {
				console.log(chalk.yellow('Preparing results'));
				console.log(chalk.yellow('================='));
			}
			reporter(resultsForReporter, options.threshold);
			driver.quit().then(function () {
				done();
			});
		});
	};

	var findGlobPatterns = function (urls) {
		return urls.map(function (url) {
			return isRemoteUrl(url) ? url : glob.sync(url);
		});
	};

	var urls = flatten(findGlobPatterns(options.urls));

	var fileExists = function (filePath) {
		try {
			return fs.statSync(filePath).isFile();
		} catch (e) {
			return false;
		}
	}

	if (options.verbose) {
		console.log(chalk.yellow('Start reading the urls'));
		console.log(chalk.yellow('======================'));
	}
	Promise.all(urls.map(function (url) {
		return new Promise(function (resolve) {
			driver
				.get(getUrl(url))
				.then(function () {
					if (options.verbose) {
						console.log(chalk.cyan('Analysis start for: ') + url);
					}
					var startTimestamp = new Date().getTime();
					var axeBuilder = new AxeBuilder(driver);

					if (options.include) {
						axeBuilder.include(options.include);
					}

					if (options.exclude) {
						axeBuilder.exclude(options.exclude);
					}

					if (tagsAreDefined) {
						axeBuilder.withTags(options.tags);
					}

					if (options.a11yCheckOptions) {
						axeBuilder.options(options.a11yCheckOptions);
					}

					axeBuilder.analyze(function (results) {
						results.url = url;
						results.timestamp = new Date().getTime();
						results.time = results.timestamp - startTimestamp;
						if (options.verbose) {
							console.log(chalk.cyan('Analyisis finished for: ') + url);
						}
						resolve(results);
					});
				});
		});

	})).then(createResults);

};
