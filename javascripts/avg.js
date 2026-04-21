document.addEventListener("DOMContentLoaded", function(event) {

  // addEventListener("click", function() {
  //     var
  //           el = document.documentElement
  //         , rfs =
  //                el.requestFullScreen
  //             || el.webkitRequestFullScreen
  //             || el.mozRequestFullScreen
  //     ;
  //     rfs.call(el);
  // });

var width = window.innerWidth;
var height = window.innerHeight;
var centerX = width / 2;
var centerY = height / 2 - height / 75;
// ry = rx * ellipseRatio (vertical radius much larger than horizontal).
var ellipseRatio = 4.5;

var distance = Math.round(Math.min(60, width/10));
var n=Math.floor((width/2)/distance)+2;
var data=new Array(n);
for(var i=0;i<n;i++){
  data[i]=(i*distance);
}

var max=data[n-1];

var scale = d3.scaleLinear()
.range(["#F48FB1","rgb(30,33,39)"])
.domain([0,max]);

var svg = d3.select("body")
  .select(".temp")
  .append("svg")
  .attr("width",width)
  .attr("height",height);

  // --- Toroidal / dipole meridional field (open arcs only; vertical axis) ---
  var fieldGroup = svg.append("g").attr("class", "dipole-field").style("pointer-events", "none");
  var fieldTimer = null;

  var FIELD_RADIUS_LS_H = "partsofbeing-field-radius-h";
  var FIELD_RADIUS_LS_V = "partsofbeing-field-radius-v";
  function readFieldRadiusStored(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (raw == null || raw === "") return fallback;
      var n = parseFloat(raw);
      return isFinite(n) ? n : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function writeFieldRadiusStored(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch (e) {}
  }

  var fieldRadiusScaleH = readFieldRadiusStored(FIELD_RADIUS_LS_H, 3);
  var fieldRadiusScaleV = readFieldRadiusStored(FIELD_RADIUS_LS_V, 1.5);

  function clampFieldRadius(v) {
    return Math.max(0.1, Math.min(3, v));
  }
  fieldRadiusScaleH = clampFieldRadius(fieldRadiusScaleH);
  fieldRadiusScaleV = clampFieldRadius(fieldRadiusScaleV);

  function formatRadius(n) {
    return (Math.round(n * 100) / 100).toFixed(2);
  }

  function mountFieldRadiusWidget() {
    if (document.getElementById("toroidal-field-radius-panel")) return;

    var panel = d3
      .select("body")
      .append("div")
      .attr("id", "toroidal-field-radius-panel")
      .attr("class", "field-radius-widget")
      .attr("role", "region")
      .attr("aria-label", "Toroidal field size controls");

    panel.append("h3").text("Toroidal field radius");

    function addRow(labelText, cls, initial, onChange) {
      var row = panel.append("div").attr("class", "field-radius-row");
      var lab = row.append("label").attr("for", "field-radius-" + cls);
      lab.append("span").attr("class", "field-radius-label").text(labelText);
      var val = lab.append("span").attr("class", "field-radius-value " + cls).text(formatRadius(initial));
      var input = row
        .append("input")
        .attr("id", "field-radius-" + cls)
        .attr("type", "range")
        .attr("min", 0.1)
        .attr("max", 3)
        .attr("step", 0.01)
        .property("value", initial);
      input.on("input", function () {
        var v = clampFieldRadius(+this.value);
        val.text(formatRadius(v));
        onChange(v);
      });
      input.on("change", function () {
        var v = clampFieldRadius(+this.value);
        if (cls === "h") writeFieldRadiusStored(FIELD_RADIUS_LS_H, v);
        if (cls === "v") writeFieldRadiusStored(FIELD_RADIUS_LS_V, v);
      });
      return input;
    }

    addRow("Horizontal", "h", fieldRadiusScaleH, function (v) {
      fieldRadiusScaleH = v;
      renderDipoleField(width, height, centerX, centerY);
    });

    addRow("Vertical", "v", fieldRadiusScaleV, function (v) {
      fieldRadiusScaleV = v;
      renderDipoleField(width, height, centerX, centerY);
    });
  }

  function dipoleScreenPoint(r0, theta, sign, centerX, centerY, kappaX, kappaZ) {
    // Keep each loop in its own hemisphere for the full 0..2pi cycle.
    // Without abs(sin), the second half of the cycle crosses hemispheres,
    // which looks like a direction flip/parallax reversal.
    var sinTheta = Math.sin(theta);
    var rho = r0 * Math.pow(Math.abs(sinTheta), 3);
    var z = r0 * Math.pow(sinTheta, 2) * Math.cos(theta);
    return {
      x: centerX + sign * kappaX * rho,
      y: centerY - kappaZ * z
    };
  }

  /**
   * Build a full closed streamline for each hemisphere.
   */
  function buildClosedDipolePath(r0, sign, cx, cy, kappaX, kappaZ) {
    var pts = [];
    var theta = 0;
    var dTheta = 0.003;
    // With |sin(theta)| in rho, 0..2pi retraces the same lobe in reverse.
    // Use 0..pi so each bead follows one loop with consistent direction.
    var thetaCap = Math.PI;
    while (theta < thetaCap) {
      var p = dipoleScreenPoint(r0, theta, sign, cx, cy, kappaX, kappaZ);
      pts.push([p.x, p.y]);
      theta += dTheta;
    }
    return pts;
  }

  function renderDipoleField(w, h, cx, cy) {
    if (fieldTimer) {
      fieldTimer.stop();
      fieldTimer = null;
    }
    fieldGroup.selectAll("*").remove();

    var minDim = Math.min(w, h);
    var margin = Math.max(48, minDim * 0.06);

    var r0Min = 0.58;
    var r0Max = 1.12;
    var lineCount = minDim < 520 ? 5 : 7;
    var r0Step = lineCount > 1 ? (r0Max - r0Min) / (lineCount - 1) : 0;
    var r0Values = d3.range(lineCount).map(function (i) { return r0Min + i * r0Step; });

    // Choose baseline kappa from the viewport; widget multipliers scale both axes.
    function estimateMaxForR0(r0) {
      var theta = 0.07 * Math.PI;
      var dTheta = 0.0015;
      var thetaCap = Math.PI / 2 - 0.02;
      var maxRho = 0;
      var maxZ = 0;
      while (theta < thetaCap) {
        var s = Math.sin(theta);
        var z = r0 * Math.pow(s, 2) * Math.cos(theta);
        var rho = r0 * Math.pow(s, 3);
        if (rho > maxRho) maxRho = rho;
        if (z > maxZ) maxZ = z;
        theta += dTheta;
      }
      return { maxRho: maxRho, maxZ: maxZ };
    }

    var est = estimateMaxForR0(r0Max);
    var availableHalfHeight = Math.max(1, h / 2 - margin);
    var kappaZBase = est.maxZ > 0 ? (availableHalfHeight / est.maxZ) : (minDim * 0.72);

    var availableHalfWidth = Math.max(1, w / 2 - margin);
    var kappaXFromWidth = est.maxRho > 0 ? (availableHalfWidth / est.maxRho) : (minDim * 0.2);
    var kappaXBase = Math.min(kappaXFromWidth * 0.42, minDim * 0.28);

    var kappaZ = kappaZBase * fieldRadiusScaleV;
    var kappaX = kappaXBase * fieldRadiusScaleH;

    // Explicitly closed loops to avoid wraparound seam direction artifacts.
    var lineGen = d3.line().curve(d3.curveLinearClosed);

    var paths = [];
    r0Values.forEach(function (r0) {
      [-1, 1].forEach(function (sign) {
        var pts = buildClosedDipolePath(r0, sign, cx, cy, kappaX, kappaZ);
        if (pts.length < 4) return;
        paths.push({ r0: r0, sign: sign, d: lineGen(pts) });
      });
    });

    fieldGroup
      .selectAll("path.dipole-stream")
      .data(paths)
      .enter()
      .append("path")
      .attr("class", "dipole-stream")
      .attr("d", function (d) { return d.d; })
      .attr("fill", "none")
      .attr("stroke", "rgba(232, 112, 122, 0.38)")
      .attr("stroke-width", Math.max(0.85, minDim / 520))
      .attr("stroke-linecap", "round")
      .attr("stroke-linejoin", "round");

    var pathNodes = fieldGroup.selectAll("path.dipole-stream").nodes();

    var beadsPerEllipse = 10;
    var particleData = [];
    paths.forEach(function (p, pathIndex) {
      for (var bi = 0; bi < beadsPerEllipse; bi++) {
        particleData.push({
          pathIndex: pathIndex,
          beadIndex: bi,
          beadPhase: bi / beadsPerEllipse
        });
      }
    });

    fieldGroup
      .selectAll("circle.dipole-particle")
      .data(particleData)
      .enter()
      .append("circle")
      .attr("class", "dipole-particle")
      .attr("r", Math.max(1.6, minDim / 420))
      .attr("fill", "rgba(255, 183, 189, 0.85)")
      .attr("stroke", "none")
      .each(function (d) {
        var pathNode = pathNodes[d.pathIndex];
        d._path = pathNode;
        d._len = pathNode ? pathNode.getTotalLength() : 0;
        d._speed = 0;
        d._headOffset = 0;
        d._phaseOffset = 0;
        d._dir = 1;
        if (pathNode && d._len) {
          // Start at vertical midpoint (y ~= cy), preferring the inner-axis crossing.
          var sampleCount = 220;
          var startDist = 0;
          var startScore = Infinity;
          for (var si = 0; si <= sampleCount; si++) {
            var sDist = (si / sampleCount) * d._len;
            var sPt = pathNode.getPointAtLength(sDist);
            var axisDx = Math.abs(sPt.x - cx);
            var centerDy = Math.abs(sPt.y - cy);
            var score = centerDy + 0.25 * axisDx;
            if (score < startScore) {
              startScore = score;
              startDist = sDist;
            }
          }
          d._headOffset = startDist;

          // Pick direction so motion at t=0 goes upward (decreasing y).
          var eps = Math.max(0.5, d._len * 0.002);
          var pHeadFwd = pathNode.getPointAtLength((d._headOffset + eps) % d._len);
          var pHeadBwd = pathNode.getPointAtLength((d._headOffset - eps + d._len) % d._len);
          d._dir = pHeadFwd.y <= pHeadBwd.y ? -1 : 1;
          d._phaseOffset = d.beadPhase * d._len;

          var startDist = (d._headOffset + d._phaseOffset) % d._len;
          var pHead = pathNode.getPointAtLength(startDist);
          d3.select(this).attr("cx", pHead.x).attr("cy", pHead.y);
        }
      });

    // Keep all beads phase-locked: they all re-enter from the top together once per cycle.
    // Outer loops are longer, so they move proportionally faster.
    var cycleDurationMs = Math.max(5200, 7000 - minDim * 1.8) * 3;
    fieldGroup.selectAll("circle.dipole-particle").each(function (d) {
      d._speed = d._len > 0 ? (d._len / cycleDurationMs) : 0;
    });

    var t0 = d3.now();
    fieldTimer = d3.timer(function () {
      var elapsed = d3.now() - t0;
      fieldGroup.selectAll("circle.dipole-particle").each(function (d) {
        if (!d._path || !d._len || !d._speed) return;
        var distance = (d._headOffset + d._phaseOffset + (d._dir * elapsed * d._speed)) % d._len;
        if (distance < 0) distance += d._len;
        var pt = d._path.getPointAtLength(distance);
        d3.select(this).attr("cx", pt.x).attr("cy", pt.y);
      });
    });
  }

  mountFieldRadiusWidget();
  renderDipoleField(width, height, centerX, centerY);

  var resizeTimer = null;
  window.addEventListener("resize", function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      width = window.innerWidth;
      height = window.innerHeight;
      centerX = width / 2;
      centerY = height / 2 - height / 75;
      svg.attr("width", width).attr("height", height);
      renderDipoleField(width, height, centerX, centerY);
    }, 120);
  });

//Container for the gradient
// var defs = svg.append("defs");

// var filter = defs.append("filter")
// 		.attr("id","glow");
//
// 	filter.append("feGaussianBlur")
// 		.attr("class", "blur")
// 		.attr("stdDeviation","4.5")
// 		.attr("result","coloredBlur");
//
// 	var feMerge = filter.append("feMerge");
// 	feMerge.append("feMergeNode")
// 		.attr("in","coloredBlur");
// 	feMerge.append("feMergeNode")
// 		.attr("in","SourceGraphic");

//Append a linear horizontal gradient
// var linearGradient = defs.append("linearGradient")
// 	.attr("id","animate-gradient") //unique id to reference the gradient by
// 	.attr("x1","0%")
// 	.attr("y1","0%")
// 	.attr("x2","0%")
// 	.attr("y2","100%")
// 	//Make sure the areas before 0% and after 100% (along the x)
// 	//are a mirror image of the gradient and not filled with the
// 	//color at 0% and 100%
// 	.attr("spreadMethod", "reflect");
//
// //A color palette that is 4 colors (the last 3 colors are the reverse of the start)
// var colours = ["#FFC400", "#FFD740", "#fff", "#FFD740","#FFC400"];
//
// //Append the colors evenly along the gradient
// linearGradient.selectAll(".stop")
// 	.data(colours)
// 	.enter().append("stop")
// 	.attr("offset", function(d,i) { return i/(colours.length-1); })
// 	.attr("stop-color", function(d) { return d; });
//
//
// linearGradient.append("animate")
// 	.attr("attributeName","y1")
// 	.attr("values","0%;100%")
// 	.attr("dur","4s")
// 	.attr("repeatCount","indefinite");
//
//
// linearGradient.append("animate")
// .attr("attributeName","y2")
// .attr("values","100%;200%")
// .attr("dur","4s")
// .attr("repeatCount","indefinite");

var height_man=height/3;

svg.append("svg:image")
       .attr("class", "manimage")
      //  .attr('x',width/2)
      //  .attr('y',height/2-height/75)
      //  .attr('width', 0)
      //  .attr('height', 0)
       .attr("xlink:href","images/man.svg")
      //  .transition()
      //  .duration(4000)
       .attr('x',centerX-0.97*height_man/2)
       .attr('y',height/2-height_man/2)
       .attr('width', 0.97*height_man)
       .attr('height', height_man)
       .attr("fill", "none")
       .attr("opacity", 1);
      //  .style("filter","url(#glow)");

  var ellipses = svg.selectAll("ellipse")
  .data(data)
  .enter()
  .append("ellipse")
  .attr("rx", function(d) { return d-distance; })
  .attr("ry", function(d) { return (d-distance)/ellipseRatio; })
  .attr("cx", centerX)
  .attr("cy", centerY)
  .attr("fill","none")
  .style("stroke",function(d) { return scale(d) })
  .attr("stroke-width", 1.5);

  var height_halfman=height_man*0.475;

  // svg.append("svg:image")
  //     .attr("xlink:href","images/light.gif")
  // 		.attr("x", width/2-18)
  // 		.attr("y", 0)
  // 		// .attr("width", Math.min(26, width/100))
  // 		.attr("height", height/2-0.97*height_halfman)
  //     // .attr("fill", "#FFC400");
  // 		// .style("fill", "url(#animate-gradient)");
  //     // .style("filter","url(#glow)");

  // svg.append("rect")
  // 		.attr("x", width/2-Math.min(4, width/200))
  // 		.attr("y", 0)
  // 		.attr("width", Math.min(8, width/100))
  // 		.attr("height", height/2-height/75)
  // 		.style("fill", "url(#animate-gradient)");

  svg.append("svg:image")
         .attr("class", "manimage")
        //  .attr('x',width/2)
        //  .attr('y',height/2-height/75)
        //  .attr('width', 0)
        //  .attr('height', 0)
         .attr("xlink:href","images/halfman.svg")
        //  .transition()
        //  .duration(4000)
         .attr('x',centerX-0.93*height_halfman/2)
         .attr('y',height/2-1.03*height_halfman)
         .attr('width', 0.93*height_halfman)
         .attr('height', height_halfman)
         .attr("fill", "none")
         .attr("opacity", 0.8);

  // svg.append("rect")
  //   .attr("x", width/2-Math.min(4, width/200))
  //   .attr("y", 0)
  //   .attr("width", Math.min(8, width/100))
  //   .attr("height", height/2-height/75)
  //   .style("fill", "url(#animate-gradient)")
  //   .attr("opacity", 0.4);

  svg.append("svg:image")
         .attr("class", "lotusimage")
        //  .attr('x',width/2)
        //  .attr('y',height/2-height/75)
        //  .attr('width', 0)
        //  .attr('height', 0)
         .attr("xlink:href","images/lotus.svg")
        //  .transition()
        //  .duration(4000)
         .attr('x',centerX-30)
         .attr('y',height/2-height/22)
         .attr('width', 60)
         .attr('height', 40);
        //  .style("filter","url(#glow)");

function nextRingValue(d) {
  return d === max ? 0 : d + distance;
}

function transition() {
  var boundEllipses = ellipses.data(data);
  var animatedEllipses = boundEllipses.filter(function(d) { return d > 0 });
  var completedTransitions = 0;

  boundEllipses
    .filter(function(d) { return d === 0; })
    .attr("rx",0)
    .attr("ry",0)
    .style("opacity",1)
    .style("stroke",function(d) { return scale(d); });

  animatedEllipses
     .transition()
     .ease(d3.easeLinear)
     .duration(4000)
     .attr("rx", function(d) { return d; })
     .attr("ry", function(d) { return d/ellipseRatio; })
     .style("stroke", function(d) { return scale(d) })
     .style("opacity",function(d) {
       return d === max ? 0 : 1;
      })
     .on("end",function(){
       if(++completedTransitions === animatedEllipses.size()) {
         data = data.map(nextRingValue);
         transition();
       }
     });

}
transition();

;})
