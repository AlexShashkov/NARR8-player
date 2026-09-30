// Replacement for the lost "foreditor/mouse.js" of the 2012-2013 NARR8 engine.
// Same contract as the engine's own utils/touch.js (touchController): report taps and drags on engine.control
// to engine.controlObj as touchstart / scrollstart / scroll / touchend / scrollend, in page coordinates minus
// the (x1, y1) origin. On touch screens the original touchController is attached as well.
var mouseController = function (x1, y1, x2, y2, canvas) {
  this.x1 = x1; this.y1 = y1; this.x2 = x2; this.y2 = y2;
  this.canvas = canvas;
  this.down = false;
  this.scrolling = 0;
  this.touch = null;

  var that = this;
  var target = canvas.control;

  function inside(e) {
    return e.pageX >= that.x1 && e.pageY >= that.y1 && e.pageX <= that.x2 && e.pageY <= that.y2;
  }

  target.addEventListener("mousedown", function (e) {
    if (e.button !== 0) return;
    e.preventDefault();
    if (canvas.controlObj === undefined || !inside(e)) return;
    that.down = true;
    that.scrolling = 0;
    that.bx = that.tx = e.pageX - that.x1;
    that.by = that.ty = e.pageY - that.y1;
    canvas.controlObj.touchstart({ x: that.bx, y: that.by });
  }, true);

  window.addEventListener("mousemove", function (e) {
    if (!that.down || canvas.controlObj === undefined) return;
    that.tx = e.pageX - that.x1;
    that.ty = e.pageY - that.y1;
    var dist = Math.sqrt((that.bx - that.tx) * (that.bx - that.tx) + (that.by - that.ty) * (that.by - that.ty));
    if (!that.scrolling) {
      if (dist > 15) {
        that.scrolling = 1;
        canvas.controlObj.scrollstart({ x: that.bx, y: that.by, dir: Math.abs(that.by - that.ty) > 7.5, cbh: Math.abs(that.bx - that.tx) > 7.5 });
      }
    } else {
      canvas.controlObj.scroll({ x: that.tx, y: that.ty });
    }
  }, true);

  window.addEventListener("mouseup", function (e) {
    if (!that.down) return;
    that.down = false;
    if (canvas.controlObj === undefined) return;
    if (!that.scrolling) {
      canvas.controlObj.touchend({ x: that.bx, y: that.by, e: e });
    } else {
      that.scrolling = 0;
      canvas.controlObj.scrollend();
    }
  }, true);

  if ((("ontouchstart" in window) || navigator.maxTouchPoints > 0) && typeof touchController === "function") {
    this.touch = new touchController(x1, y1, x2, y2, canvas);
  }
};

mouseController.prototype.changeOffset = function (x1, y1, x2, y2) {
  this.x1 = x1; this.y1 = y1; this.x2 = x2; this.y2 = y2;
  if (this.touch) this.touch.changeOffset(x1, y1, x2, y2);
};
