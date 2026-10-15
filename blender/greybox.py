# Blender greybox for one shot: character models, the sequence's set, lights and a moving camera.
# The clip guides H3 (layout, camera and timing for the first denoise steps), so it stays plain: grey
# shapes, but each character is built from their model (height, build, costume, what they carry, the
# light they carry), so the guide already shows who is who.
#
#   blender -b --factory-startup -P blender/greybox.py -- --spec shot.json --out frames_dir
#
# spec: { fps, frames, width, height, mode: 'shot' | 'turnaround', mist, sun: {azimuth, elevation},
#         (mist is accepted but not drawn: the prompt carries it)
#         camera: {from: [x,y,z], to: [x,y,z], look: [x,y,z], look2?: [x,y,z], lens},
#         actors: [{label, pose, x, z, heading, x2?, z2?, pose2?, y?, model?}],
#         props: [{label, kind, x, z, w, h, d, y?, rot?, tilt?, tilt2?}],
#         lights: [{label, x, y, z, size, color?, x2?, y2?, z2?}] }
# Engine coordinates are metres with y up; Blender's are z up, so (x, y, z) becomes (x, -z, y).
# A prop's tilt (degrees) leans it over its front bottom edge, from tilt to tilt2 over the shot: a gate
# falling flat is tilt 0 to tilt2 90.
import bpy, json, math, sys, os, random
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
args = dict(zip(argv[::2], argv[1::2]))
spec = json.load(open(args['--spec'], encoding='utf-8'))
out = args['--out']
os.makedirs(out, exist_ok=True)
MODE = spec.get('mode', 'shot')
F0, F1 = 1, int(spec.get('frames', 144)) if MODE == 'shot' else 1


def B(p):
    x, y, z = p
    return Vector((x, -z, y))


for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
scene = bpy.context.scene
try:
    scene.render.engine = 'BLENDER_EEVEE'
    scene.eevee.taa_render_samples = 8
    try:
        scene.eevee.volumetric_samples = 32
    except Exception:
        pass
    EEVEE = True
except Exception:
    scene.render.engine = 'BLENDER_WORKBENCH'
    EEVEE = False
if not EEVEE:
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'MATERIAL'
    scene.display.shading.show_shadows = True
scene.view_settings.view_transform = 'Standard'
scene.render.resolution_x = int(spec.get('width', 960))
scene.render.resolution_y = int(spec.get('height', 544))
scene.render.resolution_percentage = 100
scene.render.fps = int(spec.get('fps', 24))
scene.frame_start, scene.frame_end = F0, F1
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = os.path.join(out, '')

# A dim grey world, with distance mist when asked.
world = bpy.data.worlds.new('world')
scene.world = world
world.use_nodes = True
wn = world.node_tree.nodes
wn['Background'].inputs['Color'].default_value = (0.10, 0.10, 0.11, 1)  # bright enough that every shape reads in the guide
wn['Background'].inputs['Strength'].default_value = 1.0
# No world volume: EEVEE's world volume extinguishes the sun, and the guide only needs shapes. Mist lives in the prompt.
mist = float(spec.get('mist', 0) or 0)


def hexrgb(h, d=(0.6, 0.6, 0.6)):
    try:
        h = h.lstrip('#')
        return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    except Exception:
        return d


_mats = {}
def mat(name, rgb, emit=0.0):
    key = (name, tuple(round(c, 3) for c in rgb), emit)
    if key in _mats:
        return _mats[key]
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, 1)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    if bsdf:
        bsdf.inputs['Base Color'].default_value = (*rgb, 1)
        bsdf.inputs['Roughness'].default_value = 0.85
        if emit > 0:
            bsdf.inputs['Emission Color'].default_value = (*rgb, 1)
            bsdf.inputs['Emission Strength'].default_value = emit
    _mats[key] = m
    return m


GROUND = mat('ground', (0.30, 0.30, 0.29))
PROP = mat('prop', (0.52, 0.51, 0.48))
SKIN = mat('skin', (0.80, 0.74, 0.66))

bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 0, 0))
bpy.context.object.data.materials.append(GROUND)


def add(obj, m, parent=None, name=None):
    if m is not None:
        obj.data.materials.append(m)
    if parent is not None:
        obj.parent = parent
    if name:
        obj.name = name
    return obj


def box(loc, size, m, parent=None, rot=None, name=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object
    o.scale = size
    if rot:
        o.rotation_euler = rot
    return add(o, m, parent, name)


def cyl(a, b, r, m, parent=None, r2=None, verts=16, name=None):
    a, b = Vector(a), Vector(b)
    d = b - a
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=max(d.length, 0.01), location=(a + b) / 2, vertices=verts)
    else:
        bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r2, depth=max(d.length, 0.01), location=(a + b) / 2, vertices=verts)
    o = bpy.context.object
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized() if d.length else Vector((0, 0, 1)))
    return add(o, m, parent, name)


def sphere(loc, r, m, parent=None, name=None):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=20, ring_count=10)
    return add(bpy.context.object, m, parent, name)


# Poses: lean (deg forward), arm angle (deg up from hanging), leg swing, crouch (0..1), arm reach forward.
POSES = {
    'stand':    dict(lean=0, arms=10, legs=0, crouch=0, fwd=0),
    'walk':     dict(lean=5, arms=22, legs=22, crouch=0, fwd=0.1),
    'run':      dict(lean=16, arms=50, legs=40, crouch=0.05, fwd=0.2),
    'kneel':    dict(lean=5, arms=15, legs=0, crouch=0.45, fwd=0.1),
    'sit':      dict(lean=0, arms=15, legs=0, crouch=0.5, fwd=0),
    'arms-up':  dict(lean=-6, arms=165, legs=0, crouch=0, fwd=0),
    'reach':    dict(lean=10, arms=85, legs=0, crouch=0, fwd=0.6),
    'bow':      dict(lean=45, arms=10, legs=0, crouch=0.05, fwd=0),
    'lie':      dict(lean=90, arms=5, legs=0, crouch=0.75, fwd=0),
    'cower':    dict(lean=35, arms=120, legs=0, crouch=0.4, fwd=0.2),
    'stagger':  dict(lean=-18, arms=60, legs=25, crouch=0.08, fwd=0.3),
    'point':    dict(lean=0, arms=100, legs=0, crouch=0, fwd=0.7),
    'prostrate': dict(lean=80, arms=90, legs=0, crouch=0.7, fwd=0.6),
}
BUILD = {'slight': (0.85, 1.0), 'average': (1.0, 1.0), 'broad': (1.25, 1.0), 'gaunt': (0.78, 1.04), 'colossal': (1.35, 1.0)}


def figure(name, model, pose_name):
    """A character built from their model, standing at the origin facing -y (towards the camera at heading 0)."""
    model = model or {}
    root = bpy.data.objects.new(name, None)
    scene.collection.objects.link(root)
    H = float(model.get('height', 1.75))
    k = H / 1.75
    wide, _ = BUILD.get(model.get('build', 'average'), (1.0, 1.0))
    pose = POSES.get(pose_name, POSES['stand'])
    cloth = mat('cloth-' + str(model.get('color', '')), hexrgb(model.get('color', '#8a7f72')), emit=0.5 * float(model.get('glow', 0) or 0))
    costume = model.get('costume', 'tunic')
    hip = 0.95 * k * (1 - pose['crouch'])
    lean = math.radians(pose['lean'])
    neck = Vector((0, -math.sin(lean) * 0.6 * k, hip + math.cos(lean) * 0.6 * k))
    torso_r = 0.17 * k * wide
    if costume == 'armor':
        box(((neck + Vector((0, 0, hip))) / 2), (torso_r * 2.3, torso_r * 1.5, (neck.z - hip) * 1.05), cloth, root)
    else:
        cyl((0, 0, hip), neck, torso_r, cloth, root, r2=torso_r * 1.1)
    head_c = neck + Vector((0, -math.sin(lean) * 0.14 * k, math.cos(lean) * 0.14 * k))
    sphere(head_c, 0.115 * k, SKIN, root, 'head')
    hair = model.get('hair', 'short')
    hair_m = mat('hair', (0.16, 0.13, 0.11))
    if hair == 'long':
        cyl(head_c + Vector((0, 0.05 * k, 0.04 * k)), head_c + Vector((0, 0.08 * k, -0.22 * k)), 0.1 * k, hair_m, root)
    if model.get('beard'):
        cyl(head_c + Vector((0, -0.07 * k, -0.06 * k)), head_c + Vector((0, -0.09 * k, -0.2 * k)), 0.07 * k, hair_m, root, r2=0.02 * k)
    if model.get('crown'):
        bpy.ops.mesh.primitive_torus_add(major_radius=0.1 * k, minor_radius=0.018 * k, location=head_c + Vector((0, 0, 0.1 * k)))
        add(bpy.context.object, mat('gold', (0.85, 0.68, 0.3)), root)
    # legs, under a skirt for robes
    long_skirt = costume in ('robe', 'regal', 'shroud')
    for side in (-1, 1):
        sw = math.radians(pose['legs']) * side
        leg_m = SKIN if costume == 'loincloth' else cloth
        if pose['crouch'] >= 0.3:
            # folded: thigh forward to a knee near the ground, shin back under the body
            knee = Vector((side * 0.11 * k, -0.42 * k, 0.1 * k))
            cyl((side * 0.1 * k, 0, hip), knee, 0.075 * k * wide, leg_m, root)
            cyl(knee, (side * 0.11 * k, 0.05 * k, 0.06 * k), 0.07 * k * wide, leg_m, root)
        else:
            foot = Vector((side * 0.1 * k, math.sin(sw) * hip, max(0.05, hip - math.cos(sw) * hip)))
            cyl((side * 0.1 * k, 0, hip), foot, 0.075 * k * wide, leg_m, root)
        ar = math.radians(pose['arms'])
        sh = Vector((side * 0.22 * k * wide, neck.y, neck.z - 0.05 * k))
        hand = Vector((sh.x + side * math.sin(ar) * 0.25 * k * (0 if pose['fwd'] > 0.5 else 1), sh.y - 0.1 * k - pose['fwd'] * 0.55 * k, sh.z - math.cos(ar) * 0.6 * k))
        cyl(sh, hand, 0.055 * k * wide, SKIN if costume in ('loincloth', 'rags') else cloth, root)
        if side == 1:
            right_hand = hand
    if long_skirt:
        if pose['crouch'] > 0.3:
            cyl((0, 0, 0.03), (0, 0, hip + 0.05 * k), torso_r * 1.6, cloth, root, r2=torso_r * 1.05)
        else:
            cyl((0, 0, 0.03), (0, 0, hip + 0.05 * k), torso_r * 2.0, cloth, root, r2=torso_r * 1.05)
    elif costume in ('tunic', 'rags', 'armor'):
        cyl((0, 0, hip * 0.55), (0, 0, hip + 0.05 * k), torso_r * 1.6, cloth, root, r2=torso_r * 1.05)
    elif costume == 'loincloth':
        cyl((0, 0, hip * 0.8), (0, 0, hip + 0.03 * k), torso_r * 1.2, cloth, root)
    if model.get('wings'):
        wing_m = mat('wing', (0.1, 0.1, 0.11))
        for side in (-1, 1):
            cyl(neck + Vector((side * 0.12 * k, 0.12 * k, 0.05 * k)), Vector((side * 0.7 * k, 0.35 * k, hip * 0.5)), 0.18 * k, wing_m, root, r2=0.02 * k)
    carry = model.get('carry', 'none')
    wood = mat('wood', (0.36, 0.27, 0.18))
    if carry == 'cross':
        # the upright over the right shoulder, foot trailing on the ground behind
        top = Vector((0.25 * k, -0.25 * k, neck.z + 0.6 * k))
        foot = Vector((0.25 * k, 1.9 * k, 0.05))
        cyl(foot, top, 0.07 * k, wood, root, verts=4)
        mid = top + (foot - top) * 0.22
        cyl(mid + Vector((-0.75 * k, 0, 0)), mid + Vector((0.75 * k, 0, 0)), 0.065 * k, wood, root, verts=4)
    elif carry == 'crossbeam':
        cyl(neck + Vector((-0.9 * k, 0.1 * k, -0.02)), neck + Vector((0.9 * k, 0.1 * k, -0.02)), 0.07 * k, wood, root, verts=4)
    elif carry == 'lyre':
        box(right_hand + Vector((0, -0.05, 0.12 * k)), (0.22 * k, 0.05 * k, 0.3 * k), mat('gold', (0.85, 0.68, 0.3)), root)
    elif carry == 'staff':
        cyl(Vector((right_hand.x, right_hand.y, 0.02)), Vector((right_hand.x, right_hand.y, H + 0.2 * k)), 0.025 * k, wood, root)
    elif carry in ('chains', 'keys'):
        iron = mat('iron', (0.22, 0.23, 0.25))
        for i in range(3 if carry == 'chains' else 1):
            bpy.ops.mesh.primitive_torus_add(major_radius=(0.24 if carry == 'chains' else 0.12) * k * wide, minor_radius=0.02 * k, location=(0, 0, hip + (i * 0.16 - 0.05) * k if carry == 'chains' else hip))
            add(bpy.context.object, iron, root)
    glow = float(model.get('glow', 0) or 0)
    if glow > 0:
        # a disc of light behind the head (a halo the camera sees around the face, not over it)
        cyl(head_c + Vector((0, 0.17 * k, 0.02)), head_c + Vector((0, 0.19 * k, 0.02)), 0.24 * k, mat('halo', (1.0, 0.95, 0.82), emit=2.5 * glow), root, verts=32, name='halo')
        bpy.ops.object.light_add(type='POINT', location=head_c + Vector((0, -0.3 * k, 0.2 * k)))
        L = bpy.context.object
        L.data.energy = 350 * glow * k * k
        L.data.shadow_soft_size = 0.6
        L.data.color = (1.0, 0.95, 0.85)
        L.parent = root
    return root


def place(root, a, frame=None):
    root.location = B((a.get('x', 0), a.get('y', 0), a.get('z', 0)))
    root.rotation_euler = (0, 0, math.radians(a.get('heading', 0)))


def actor(i, a):
    model = a.get('model') or {}
    crowd = int(model.get('crowd', 0) or 0)
    pose2 = a.get('pose2')
    moving = a.get('x2') is not None or a.get('z2') is not None
    rnd = random.Random(1000 + i)
    members = [(0.0, 0.0, 0.0, a.get('pose', 'stand'), pose2)]
    if crowd > 1:
        r = 0.55 * math.sqrt(crowd)
        mix = ['reach', 'arms-up', 'kneel', 'stand', 'cower', 'walk', a.get('pose', 'stand')]
        members = []
        for n in range(crowd):
            ang, rad = rnd.uniform(0, 2 * math.pi), r * math.sqrt(rnd.random())
            members.append((math.cos(ang) * rad, math.sin(ang) * rad, rnd.uniform(-35, 35), rnd.choice(mix), pose2))
    for n, (dx, dz, dh, p1, p2) in enumerate(members):
        m = dict(model)
        if crowd > 1:
            m['height'] = float(model.get('height', 1.7)) * rnd.uniform(0.82, 1.08)
        start = dict(a, x=a.get('x', 0) + dx, z=a.get('z', 0) + dz, heading=a.get('heading', 0) + dh)
        end = dict(start, x=(a.get('x2', a.get('x', 0))) + dx, z=(a.get('z2', a.get('z', 0))) + dz)
        poses = [(p1, F0, F1)] if not p2 or MODE != 'shot' else [(p1, F0, (F0 + F1) // 2), (p2, (F0 + F1) // 2 + 1, F1)]
        for pname, fa, fb in poses:
            root = figure(f"{a.get('label', 'actor')}-{n}-{pname}", m, pname)
            place(root, start)
            if moving and MODE == 'shot':
                root.keyframe_insert('location', frame=F0)
                place(root, end)
                root.keyframe_insert('location', frame=F1)
            if len(poses) > 1:
                kids = [root] + list(root.children_recursive)
                for o in kids:
                    for f, hidden in ((F0, fa != F0), (fa, False), (fb + 1, True)):
                        if F0 <= f <= F1 + 1:
                            o.hide_render = hidden
                            o.keyframe_insert('hide_render', frame=f)


def prop(pr):
    w, h, d = float(pr.get('w', 1)), float(pr.get('h', 1)), float(pr.get('d', 1))
    y0 = float(pr.get('y', 0))
    kind = pr.get('kind', 'box')
    m = mat('prop-' + kind, (0.56, 0.52, 0.45) if kind in ('arch', 'wall') else (0.5, 0.5, 0.48))
    pivot = bpy.data.objects.new(pr.get('label', kind), None)
    scene.collection.objects.link(pivot)
    # the pivot is the bottom edge nearest the camera (+z), so a positive tilt topples the prop towards the camera
    pivot.location = B((pr.get('x', 0), y0, pr.get('z', 0) + d / 2))
    pivot.rotation_euler = (0, 0, math.radians(pr.get('rot', 0)))
    c = Vector((0, d / 2, h / 2))  # local, Blender axes: +y is away from the camera
    if kind == 'cylinder':
        cyl(c - Vector((0, 0, h / 2)), c + Vector((0, 0, h / 2)), w / 2, m, pivot, verts=24)
    elif kind == 'plane':
        box((0, d / 2, 0.01), (w, d, 0.02), m, pivot)
    elif kind == 'arch':
        t = max(0.4, w * 0.12)
        box((-w / 2 + t / 2, d / 2, h / 2), (t, d, h), m, pivot)
        box((w / 2 - t / 2, d / 2, h / 2), (t, d, h), m, pivot)
        box((0, d / 2, h - t / 2), (w, d, t), m, pivot)
    elif kind == 'stairs':
        n = max(3, int(h / 0.2))
        for s in range(n):
            box((0, d * (s + 0.5) / n, h * (s + 0.5) / n / 2), (w, d / n, h * (s + 1) / n), m, pivot)
    elif kind == 'rock':
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.5, location=c)
        o = bpy.context.object
        o.scale = (w, d, h)
        add(o, m, pivot)
    else:
        box(c, (w, d, h) if kind != 'wall' else (w, max(d, 0.2), h), m, pivot)
    t0, t1 = pr.get('tilt'), pr.get('tilt2')
    if t0 is not None or t1 is not None:
        # positive tilt leans the top towards the camera (Blender -y): rotate about local x
        pivot.rotation_euler[0] = math.radians(float(t0 or 0))
        if MODE == 'shot' and t1 is not None:
            pivot.keyframe_insert('rotation_euler', frame=F0)
            pivot.rotation_euler[0] = math.radians(float(t1))
            pivot.keyframe_insert('rotation_euler', frame=F1)


def light(i, L):
    rgb = hexrgb(L.get('color', '#fff3dc'), (1, 0.95, 0.86))
    size = float(L.get('size', 0.5))
    s = sphere(B((L.get('x', 0), L.get('y', 2), L.get('z', 0))), size, mat(f'light{i}', rgb, emit=5), None, L.get('label', f'light{i}'))
    bpy.ops.object.light_add(type='POINT', location=(0, 0, 0))
    P = bpy.context.object
    P.data.energy = 400 * size * size * 4
    P.data.color = rgb
    P.data.shadow_soft_size = size
    P.parent = s
    if MODE == 'shot' and any(L.get(k) is not None for k in ('x2', 'y2', 'z2')):
        s.keyframe_insert('location', frame=F0)
        s.location = B((L.get('x2', L.get('x', 0)), L.get('y2', L.get('y', 2)), L.get('z2', L.get('z', 0))))
        s.keyframe_insert('location', frame=F1)


for pr in spec.get('props', []):
    prop(pr)
for i, L in enumerate(spec.get('lights', []) or []):
    light(i, L)

if MODE == 'turnaround':
    a = (spec.get('actors') or [{}])[0]
    model = dict(a.get('model') or {})
    model['crowd'] = 0
    H = float(model.get('height', 1.75))
    gap = max(1.1, H * 0.55) * (1.4 if model.get('carry') == 'cross' or model.get('wings') else 1)
    for n, hd in enumerate((0, 90, 180)):
        actor(n, {'label': f'view{hd}', 'pose': a.get('pose', 'stand'), 'x': (n - 1) * gap, 'z': 0, 'heading': hd, 'model': model})
    cam_from = [0, H * 0.55, H * 2.9 + gap * 1.8]
    spec['camera'] = {'from': cam_from, 'to': cam_from, 'look': [0, H * 0.5, 0], 'lens': 35}
    spec['sun'] = {'azimuth': 30, 'elevation': 40}
else:
    for i, a in enumerate(spec.get('actors', [])):
        actor(i, a)

cam = spec.get('camera', {})
bpy.ops.object.camera_add()
c = bpy.context.object
scene.camera = c
c.data.lens = float(cam.get('lens', 35))
c.data.clip_end = 1000
target = bpy.data.objects.new('look', None)
scene.collection.objects.link(target)
target.location = B(cam.get('look', [0, 1.5, 0]))
if MODE == 'shot' and cam.get('look2'):
    target.keyframe_insert('location', frame=F0)
    target.location = B(cam['look2'])
    target.keyframe_insert('location', frame=F1)
t = c.constraints.new('TRACK_TO'); t.target = target; t.track_axis = 'TRACK_NEGATIVE_Z'; t.up_axis = 'UP_Y'
c.location = B(cam.get('from', [0, 1.6, 8]))
c.keyframe_insert('location', frame=F0)
if MODE == 'shot':
    c.location = B(cam.get('to', cam.get('from', [0, 1.6, 8])))
    c.keyframe_insert('location', frame=F1)

sun = spec.get('sun', {'azimuth': 40, 'elevation': 35})
bpy.ops.object.light_add(type='SUN')
s = bpy.context.object
s.data.energy = max(1.5, float(sun.get('strength', 2.5)))  # the guide needs readable shapes; mood comes from the prompt
s.rotation_euler = (math.radians(90 - sun.get('elevation', 35)), 0, math.radians(sun.get('azimuth', 40)))

# smooth camera and figure moves, no ease jerk at the ends
for o in bpy.data.objects:
    ad = o.animation_data
    if ad and ad.action:
        try:
            for fc in ad.action.fcurves:
                for kp in fc.keyframe_points:
                    kp.interpolation = 'CONSTANT' if fc.data_path == 'hide_render' else 'BEZIER'
        except AttributeError:
            pass  # Blender 5 layered actions: keep the default interpolation

if MODE == 'turnaround':
    scene.render.filepath = os.path.join(out, 'turnaround.png')
    bpy.ops.render.render(write_still=True)
else:
    bpy.ops.render.render(animation=True)
print('GREYBOX_DONE', scene.frame_end)
