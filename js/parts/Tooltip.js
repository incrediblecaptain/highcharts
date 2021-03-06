/**
 * (c) 2010-2016 Torstein Honsi
 *
 * License: www.highcharts.com/license
 */
'use strict';
import H from './Globals.js';
import './Utilities.js';
var addEvent = H.addEvent,
	dateFormat = H.dateFormat,
	each = H.each,
	extend = H.extend,
	format = H.format,
	isNumber = H.isNumber,
	map = H.map,
	merge = H.merge,
	pick = H.pick,
	splat = H.splat,
	stop = H.stop,
	syncTimeout = H.syncTimeout,
	timeUnits = H.timeUnits;
/**
 * The tooltip object
 * @param {Object} chart The chart instance
 * @param {Object} options Tooltip options
 */
H.Tooltip = function () {
	this.init.apply(this, arguments);
};

H.Tooltip.prototype = {

	init: function (chart, options) {

		// Save the chart and options
		this.chart = chart;
		this.options = options;

		// Keep track of the current series
		//this.currentSeries = undefined;

		// List of crosshairs
		this.crosshairs = [];

		// Current values of x and y when animating
		this.now = { x: 0, y: 0 };

		// The tooltip is initially hidden
		this.isHidden = true;



		// Public property for getting the shared state.
		this.split = options.split && !chart.inverted;
		this.shared = options.shared || this.split;

	},

	/**
	 * Create the Tooltip label element if it doesn't exist, then return the
	 * label.
	 */
	getLabel: function () {

		var renderer = this.chart.renderer,
			options = this.options;

		if (!this.label) {
			// Create the label
			if (this.split) {
				this.label = renderer.g('tooltip');
			} else {
				this.label = renderer.label(
						'',
						0,
						0,
						options.shape || 'callout',
						null,
						null,
						options.useHTML,
						null,
						'tooltip'
					)
					.attr({
						padding: options.padding,
						r: options.borderRadius
					});

				/*= if (build.classic) { =*/
				this.label
					.attr({
						'fill': options.backgroundColor,
						'stroke-width': options.borderWidth
					})
					// #2301, #2657
					.css(options.style)
					.shadow(options.shadow);
				/*= } =*/
			}
			this.label
				.attr({
					zIndex: 8
				})
				.add();
		}
		return this.label;
	},

	update: function (options) {
		this.destroy();
		this.init(this.chart, merge(true, this.options, options));
	},

	/**
	 * Destroy the tooltip and its elements.
	 */
	destroy: function () {
		// Destroy and clear local variables
		if (this.label) {
			this.label = this.label.destroy();
		}
		clearTimeout(this.hideTimer);
		clearTimeout(this.tooltipTimeout);
	},

	/**
	 * Provide a soft movement for the tooltip
	 *
	 * @param {Number} x
	 * @param {Number} y
	 * @private
	 */
	move: function (x, y, anchorX, anchorY) {
		var tooltip = this,
			now = tooltip.now,
			animate = tooltip.options.animation !== false && !tooltip.isHidden &&
				// When we get close to the target position, abort animation and land on the right place (#3056)
				(Math.abs(x - now.x) > 1 || Math.abs(y - now.y) > 1),
			skipAnchor = tooltip.followPointer || tooltip.len > 1;

		// Get intermediate values for animation
		extend(now, {
			x: animate ? (2 * now.x + x) / 3 : x,
			y: animate ? (now.y + y) / 2 : y,
			anchorX: skipAnchor ? undefined : animate ? (2 * now.anchorX + anchorX) / 3 : anchorX,
			anchorY: skipAnchor ? undefined : animate ? (now.anchorY + anchorY) / 2 : anchorY
		});

		// Move to the intermediate value
		tooltip.getLabel().attr(now);


		// Run on next tick of the mouse tracker
		if (animate) {

			// Never allow two timeouts
			clearTimeout(this.tooltipTimeout);

			// Set the fixed interval ticking for the smooth tooltip
			this.tooltipTimeout = setTimeout(function () {
				// The interval function may still be running during destroy,
				// so check that the chart is really there before calling.
				if (tooltip) {
					tooltip.move(x, y, anchorX, anchorY);
				}
			}, 32);

		}
	},

	/**
	 * Hide the tooltip
	 */
	hide: function (delay) {
		var tooltip = this;
		clearTimeout(this.hideTimer); // disallow duplicate timers (#1728, #1766)
		delay = pick(delay, this.options.hideDelay, 500);
		if (!this.isHidden) {
			this.hideTimer = syncTimeout(function () {
				tooltip.getLabel()[delay ? 'fadeOut' : 'hide']();
				tooltip.isHidden = true;
			}, delay);
		}
	},

	/**
	 * Extendable method to get the anchor position of the tooltip
	 * from a point or set of points
	 */
	getAnchor: function (points, mouseEvent) {
		var ret,
			chart = this.chart,
			inverted = chart.inverted,
			plotTop = chart.plotTop,
			plotLeft = chart.plotLeft,
			plotX = 0,
			plotY = 0,
			yAxis,
			xAxis;

		points = splat(points);

		// Pie uses a special tooltipPos
		ret = points[0].tooltipPos;

		// When tooltip follows mouse, relate the position to the mouse
		if (this.followPointer && mouseEvent) {
			if (mouseEvent.chartX === undefined) {
				mouseEvent = chart.pointer.normalize(mouseEvent);
			}
			ret = [
				mouseEvent.chartX - chart.plotLeft,
				mouseEvent.chartY - plotTop
			];
		}
		// When shared, use the average position
		if (!ret) {
			each(points, function (point) {
				yAxis = point.series.yAxis;
				xAxis = point.series.xAxis;
				plotX += point.plotX  + (!inverted && xAxis ? xAxis.left - plotLeft : 0);
				plotY += (point.plotLow ? (point.plotLow + point.plotHigh) / 2 : point.plotY) +
					(!inverted && yAxis ? yAxis.top - plotTop : 0); // #1151
			});

			plotX /= points.length;
			plotY /= points.length;

			ret = [
				inverted ? chart.plotWidth - plotY : plotX,
				this.shared && !inverted && points.length > 1 && mouseEvent ?
					mouseEvent.chartY - plotTop : // place shared tooltip next to the mouse (#424)
					inverted ? chart.plotHeight - plotX : plotY
			];
		}

		return map(ret, Math.round);
	},

	/**
	 * Place the tooltip in a chart without spilling over
	 * and not covering the point it self.
	 */
	getPosition: function (boxWidth, boxHeight, point) {

		var chart = this.chart,
			distance = this.distance,
			ret = {},
			h = point.h || 0, // #4117
			swapped,
			first = ['y', chart.chartHeight, boxHeight,
				point.plotY + chart.plotTop, chart.plotTop,
				chart.plotTop + chart.plotHeight],
			second = ['x', chart.chartWidth, boxWidth,
				point.plotX + chart.plotLeft, chart.plotLeft,
				chart.plotLeft + chart.plotWidth],
			// The far side is right or bottom
			preferFarSide = !this.followPointer && pick(point.ttBelow, !chart.inverted === !!point.negative), // #4984
			/**
			 * Handle the preferred dimension. When the preferred dimension is tooltip
			 * on top or bottom of the point, it will look for space there.
			 */
			firstDimension = function (dim, outerSize, innerSize, point, min, max) {
				var roomLeft = innerSize < point - distance,
					roomRight = point + distance + innerSize < outerSize,
					alignedLeft = point - distance - innerSize,
					alignedRight = point + distance;

				if (preferFarSide && roomRight) {
					ret[dim] = alignedRight;
				} else if (!preferFarSide && roomLeft) {
					ret[dim] = alignedLeft;
				} else if (roomLeft) {
					ret[dim] = Math.min(max - innerSize, alignedLeft - h < 0 ? alignedLeft : alignedLeft - h);
				} else if (roomRight) {
					ret[dim] = Math.max(
						min,
						alignedRight + h + innerSize > outerSize ?
							alignedRight :
							alignedRight + h
					);
				} else {
					return false;
				}
			},
			/**
			 * Handle the secondary dimension. If the preferred dimension is tooltip
			 * on top or bottom of the point, the second dimension is to align the tooltip
			 * above the point, trying to align center but allowing left or right
			 * align within the chart box.
			 */
			secondDimension = function (dim, outerSize, innerSize, point) {
				var retVal;

				// Too close to the edge, return false and swap dimensions
				if (point < distance || point > outerSize - distance) {
					retVal = false;
				// Align left/top
				} else if (point < innerSize / 2) {
					ret[dim] = 1;
				// Align right/bottom
				} else if (point > outerSize - innerSize / 2) {
					ret[dim] = outerSize - innerSize - 2;
				// Align center
				} else {
					ret[dim] = point - innerSize / 2;
				}
				return retVal;
			},
			/**
			 * Swap the dimensions
			 */
			swap = function (count) {
				var temp = first;
				first = second;
				second = temp;
				swapped = count;
			},
			run = function () {
				if (firstDimension.apply(0, first) !== false) {
					if (secondDimension.apply(0, second) === false && !swapped) {
						swap(true);
						run();
					}
				} else if (!swapped) {
					swap(true);
					run();
				} else {
					ret.x = ret.y = 0;
				}
			};

		// Under these conditions, prefer the tooltip on the side of the point
		if (chart.inverted || this.len > 1) {
			swap();
		}
		run();

		return ret;

	},

	/**
	 * In case no user defined formatter is given, this will be used. Note that the context
	 * here is an object holding point, series, x, y etc.
	 *
	 * @returns {String|Array<String>}
	 */
	defaultFormatter: function (tooltip) {
		var items = this.points || splat(this),
			s;

		// Build the header
		s = [tooltip.tooltipFooterHeaderFormatter(items[0])];

		// build the values
		s = s.concat(tooltip.bodyFormatter(items));

		// footer
		s.push(tooltip.tooltipFooterHeaderFormatter(items[0], true));

		return s;
	},

	/**
	 * Refresh the tooltip's text and position.
	 * @param {Object} point
	 */
	refresh: function (point, mouseEvent) {
		var tooltip = this,
			chart = tooltip.chart,
			label = tooltip.getLabel(),
			options = tooltip.options,
			x,
			y,
			anchor,
			textConfig = {},
			text,
			pointConfig = [],
			formatter = options.formatter || tooltip.defaultFormatter,
			hoverPoints = chart.hoverPoints,
			shared = tooltip.shared,
			currentSeries;

		clearTimeout(this.hideTimer);

		// get the reference point coordinates (pie charts use tooltipPos)
		tooltip.followPointer = splat(point)[0].series.tooltipOptions.followPointer;
		anchor = tooltip.getAnchor(point, mouseEvent);
		x = anchor[0];
		y = anchor[1];

		// shared tooltip, array is sent over
		if (shared && !(point.series && point.series.noSharedTooltip)) {

			// hide previous hoverPoints and set new

			chart.hoverPoints = point;
			if (hoverPoints) {
				each(hoverPoints, function (point) {
					point.setState();
				});
			}

			each(point, function (item) {
				item.setState('hover');

				pointConfig.push(item.getLabelConfig());
			});

			textConfig = {
				x: point[0].category,
				y: point[0].y
			};
			textConfig.points = pointConfig;
			this.len = pointConfig.length;
			point = point[0];

		// single point tooltip
		} else {
			textConfig = point.getLabelConfig();
		}
		text = formatter.call(textConfig, tooltip);

		// register the current series
		currentSeries = point.series;
		this.distance = pick(currentSeries.tooltipOptions.distance, 16);

		// update the inner HTML
		if (text === false) {
			this.hide();
		} else {

			// show it
			if (tooltip.isHidden) {
				stop(label);
				label.attr({
					opacity: 1
				}).show();
			}

			// update text
			if (tooltip.split) {
				this.renderSplit(text, chart.hoverPoints);
			} else {
				label.attr({
					text: text.join ? text.join('') : text
				});

				// Set the stroke color of the box to reflect the point
				label.removeClass(/highcharts-color-[\d]+/g)
					.addClass('highcharts-color-' + pick(point.colorIndex, currentSeries.colorIndex));

				/*= if (build.classic) { =*/
				label.attr({
					stroke: options.borderColor || point.color || currentSeries.color || '${palette.neutralColor60}'
				});
				/*= } =*/

				tooltip.updatePosition({
					plotX: x,
					plotY: y,
					negative: point.negative,
					ttBelow: point.ttBelow,
					h: anchor[2] || 0
				});
			}

			this.isHidden = false;
		}
	},

	/**
	 * Render the split tooltip. Loops over each point's text and adds
	 * a label next to the point, then uses the distribute function to 
	 * find best non-overlapping positions.
	 */
	renderSplit: function (labels, points) {
		var tooltip = this,
			boxes = [],
			chart = this.chart,
			ren = chart.renderer,
			rightAligned = true,
			options = this.options,
			headerHeight,
			tooltipLabel = this.getLabel();

		/**
		 * Destroy a single-series tooltip
		 */
		function destroy(tt) {
			tt.connector = tt.connector.destroy();
			tt.destroy();
		}

		// Create the individual labels
		each(labels.slice(0, labels.length - 1), function (str, i) {
			var point = points[i - 1] ||
					// Item 0 is the header. Instead of this, we could also use the crosshair label
					{ isHeader: true, plotX: points[0].plotX },
				owner = point.series || tooltip,
				tt = owner.tt,
				series = point.series || {},
				colorClass = 'highcharts-color-' + pick(point.colorIndex, series.colorIndex, 'none'),
				target,
				x,
				bBox,
				boxWidth;

			// Store the tooltip referance on the series
			if (!tt) {
				owner.tt = tt = ren.label(null, null, null, point.isHeader && 'callout')
					.addClass('highcharts-tooltip-box ' + colorClass)
					.attr({
						'padding': options.padding,
						'r': options.borderRadius,
						/*= if (build.classic) { =*/
						'fill': options.backgroundColor,
						'stroke': point.color || series.color || '${palette.neutralColor80}',
						'stroke-width': options.borderWidth
						/*= } =*/
					})
					.add(tooltipLabel);

				// Add a connector back to the point
				if (point.series) {
					tt.connector = ren.path()
						.addClass('highcharts-tooltip-connector ' + colorClass)
						/*= if (build.classic) { =*/
						.attr({
							'stroke-width': series.options.lineWidth || 2,
							'stroke': point.color || series.color || '${palette.neutralColor60}'
						})
						/*= } =*/
						.add(tooltipLabel);

					addEvent(point.series, 'hide', function () {
						this.tt = destroy(this.tt);
					});
				}
			}
			tt.isActive = true;
			tt.attr({
				text: str
			});

			// Get X position now, so we can move all to the other side in case of overflow
			bBox = tt.getBBox();
			boxWidth = bBox.width + tt.strokeWidth();
			if (point.isHeader) {
				headerHeight = bBox.height;
				x = Math.max(
					0, // No left overflow
					Math.min(
						point.plotX + chart.plotLeft - boxWidth / 2,
						chart.chartWidth - boxWidth // No right overflow (#5794)
					)
				);
			} else {
				x = point.plotX + chart.plotLeft - pick(options.distance, 16) -
					boxWidth;
			}


			// If overflow left, we don't use this x in the next loop
			if (x < 0) {
				rightAligned = false;
			}

			// Prepare for distribution
			target = (point.series && point.series.yAxis && point.series.yAxis.pos) + (point.plotY || 0);
			target -= chart.plotTop;
			boxes.push({
				target: point.isHeader ? chart.plotHeight + headerHeight : target,
				rank: point.isHeader ? 1 : 0,
				size: owner.tt.getBBox().height + 1,
				point: point,
				x: x,
				tt: tt
			});
		});

		// Clean previous run (for missing points)
		each(chart.series, function (series) {
			var tt = series.tt;
			if (tt) {
				if (!tt.isActive) {
					series.tt = destroy(tt);
				} else {
					tt.isActive = false;
				}
			}
		});

		// Distribute and put in place
		H.distribute(boxes, chart.plotHeight + headerHeight);
		each(boxes, function (box) {
			var point = box.point,
				tt = box.tt,
				attr;

			// Put the label in place
			attr = {
				visibility: box.pos === undefined ? 'hidden' : 'inherit',
				x: (rightAligned || point.isHeader ? box.x : point.plotX + chart.plotLeft + pick(options.distance, 16)),
				y: box.pos + chart.plotTop
			};
			if (point.isHeader) {
				attr.anchorX = point.plotX + chart.plotLeft;
				attr.anchorY = attr.y - 100;
			}
			tt.attr(attr);

			// Draw the connector to the point
			if (!point.isHeader) {
				tt.connector.attr({
					d: [
						'M',
						point.plotX + chart.plotLeft,
						point.plotY + point.series.yAxis.pos,
						'L',
						rightAligned ?
							point.plotX + chart.plotLeft - pick(options.distance, 16) :
							point.plotX + chart.plotLeft + pick(options.distance, 16),
						box.pos + chart.plotTop + tt.getBBox().height / 2
					]
				});
			}
		});
	},

	/**
	 * Find the new position and perform the move
	 */
	updatePosition: function (point) {
		var chart = this.chart,
			label = this.getLabel(),
			pos = (this.options.positioner || this.getPosition).call(
				this,
				label.width,
				label.height,
				point
			);

		// do the move
		this.move(
			Math.round(pos.x), 
			Math.round(pos.y || 0), // can be undefined (#3977) 
			point.plotX + chart.plotLeft, 
			point.plotY + chart.plotTop
		);
	},

	/**
	 * Get the best X date format based on the closest point range on the axis.
	 */
	getXDateFormat: function (point, options, xAxis) {
		var xDateFormat,
			dateTimeLabelFormats = options.dateTimeLabelFormats,
			closestPointRange = xAxis && xAxis.closestPointRange,
			n,
			blank = '01-01 00:00:00.000',
			strpos = {
				millisecond: 15,
				second: 12,
				minute: 9,
				hour: 6,
				day: 3
			},
			date,
			lastN = 'millisecond'; // for sub-millisecond data, #4223

		if (closestPointRange) {
			date = dateFormat('%m-%d %H:%M:%S.%L', point.x);
			for (n in timeUnits) {

				// If the range is exactly one week and we're looking at a Sunday/Monday, go for the week format
				if (closestPointRange === timeUnits.week && +dateFormat('%w', point.x) === xAxis.options.startOfWeek &&
						date.substr(6) === blank.substr(6)) {
					n = 'week';
					break;
				}

				// The first format that is too great for the range
				if (timeUnits[n] > closestPointRange) {
					n = lastN;
					break;
				}

				// If the point is placed every day at 23:59, we need to show
				// the minutes as well. #2637.
				if (strpos[n] && date.substr(strpos[n]) !== blank.substr(strpos[n])) {
					break;
				}

				// Weeks are outside the hierarchy, only apply them on Mondays/Sundays like in the first condition
				if (n !== 'week') {
					lastN = n;
				}
			}

			if (n) {
				xDateFormat = dateTimeLabelFormats[n];
			}
		} else {
			xDateFormat = dateTimeLabelFormats.day;
		}

		return xDateFormat || dateTimeLabelFormats.year; // #2546, 2581
	},

	/**
	 * Format the footer/header of the tooltip
	 * #3397: abstraction to enable formatting of footer and header
	 */
	tooltipFooterHeaderFormatter: function (labelConfig, isFooter) {
		var footOrHead = isFooter ? 'footer' : 'header',
			series = labelConfig.series,
			tooltipOptions = series.tooltipOptions,
			xDateFormat = tooltipOptions.xDateFormat,
			xAxis = series.xAxis,
			isDateTime = xAxis && xAxis.options.type === 'datetime' && isNumber(labelConfig.key),
			formatString = tooltipOptions[footOrHead + 'Format'];

		// Guess the best date format based on the closest point distance (#568, #3418)
		if (isDateTime && !xDateFormat) {
			xDateFormat = this.getXDateFormat(labelConfig, tooltipOptions, xAxis);
		}

		// Insert the footer date format if any
		if (isDateTime && xDateFormat) {
			formatString = formatString.replace('{point.key}', '{point.key:' + xDateFormat + '}');
		}

		return format(formatString, {
			point: labelConfig,
			series: series
		});
	},

	/**
	 * Build the body (lines) of the tooltip by iterating over the items and returning one entry for each item,
	 * abstracting this functionality allows to easily overwrite and extend it.
	 */
	bodyFormatter: function (items) {
		return map(items, function (item) {
			var tooltipOptions = item.series.tooltipOptions;
			return (tooltipOptions.pointFormatter || item.point.tooltipFormatter)
				.call(item.point, tooltipOptions.pointFormat);
		});
	}

};
