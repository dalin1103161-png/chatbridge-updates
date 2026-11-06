#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Scoped X11 child-window controller. Consumes authenticated host commands."""
import ctypes as c
import json
import sys

x = c.CDLL('libX11.so.6')
display = c.c_void_p
window = c.c_ulong
x.XOpenDisplay.argtypes = [c.c_char_p]
x.XOpenDisplay.restype = display
d = x.XOpenDisplay(None)
if not d:
    raise RuntimeError('X11 display unavailable')
for name, args in {
    'XReparentWindow': [display, window, window, c.c_int, c.c_int],
    'XMoveResizeWindow': [display, window, c.c_int, c.c_int, c.c_uint, c.c_uint],
    'XMapWindow': [display, window],
    'XUnmapWindow': [display, window],
    'XRaiseWindow': [display, window],
    'XSetInputFocus': [display, window, c.c_int, c.c_ulong],
    'XSync': [display, c.c_int],
    'XFlush': [display],
    'XDefaultRootWindow': [display],
    'XGetInputFocus': [display, c.POINTER(window), c.POINTER(c.c_int)],
    'XQueryTree': [display, window, c.POINTER(window), c.POINTER(window), c.POINTER(c.POINTER(window)), c.POINTER(c.c_uint)],
    'XFree': [c.c_void_p],
}.items():
    getattr(x, name).argtypes = args
x.XDefaultRootWindow.restype = window
# Closed windows can race a layout request. Report these errors to the host.
errors = []
@c.CFUNCTYPE(c.c_int, display, c.c_void_p)
def on_error(_display, _event):
    errors.append('X11 window operation failed')
    return 0
x.XSetErrorHandler.argtypes = [c.c_void_p]
x.XSetErrorHandler(on_error)

def within(child, parent):
    for _ in range(32):
        if child == parent:
            return True
        root, ancestor, children, count = window(), window(), c.POINTER(window)(), c.c_uint()
        if not x.XQueryTree(d, child, c.byref(root), c.byref(ancestor), c.byref(children), c.byref(count)):
            return False
        if children:
            x.XFree(children)
        if ancestor.value in (0, child):
            return False
        child = ancestor.value
    return False

print(json.dumps({'ready': True}), flush=True)
for line in sys.stdin:
    message = {}
    try:
        errors.clear()
        message = json.loads(line)
        if message.get('focusHost'):
            target = int(message['window'])
            focused, revert = window(), c.c_int()
            x.XGetInputFocus(d, c.byref(focused), c.byref(revert))
            preserved = message.get('preserveCurrentFocus') and within(focused.value, target)
            if not preserved:
                x.XSetInputFocus(d, target, 2, 0)
            x.XSync(d, False)
            result = {'ok': not errors, 'preserved': bool(preserved)}
        else:
            child, parent = int(message['child']), int(message['parent'])
            if message.get('attach'):
                x.XUnmapWindow(d, child)
                x.XReparentWindow(d, child, parent or x.XDefaultRootWindow(d), int(message['x']), int(message['y']))
            x.XMoveResizeWindow(d, child, int(message['x']), int(message['y']), max(1, int(message['width'])), max(1, int(message['height'])))
            if message.get('visible'):
                x.XMapWindow(d, child)
            else:
                x.XUnmapWindow(d, child)
            x.XSync(d, False)
            result = {'parent': str(parent), 'ok': not errors}
        if errors:
            result['error'] = errors[-1]
    except Exception as error:
        result = {'error': str(error)}
    print(json.dumps({'id': message.get('id'), **result}), flush=True)
