# Blender greybox for one shot: plain mannequins and boxes, one sun, a moving camera.
# The clip guides H3 (layout, camera and timing for the first denoise steps), so it is plain on purpose.
#
#   blender -b --factory-startup -P blender/greybox.py -- --spec shot.json --out frames_dir
#
# spec: { fps, frames, width, height, sun: {azimuth, elevation},
#         camera: {from: [x,y,z], to: [x,y,z], look: [x,y,z], lens},   # metres, y up (engine coordinates)
#         actors: [{label, pose, x, z, heading}], props: [{label, kind, x, z, w, h, d}] }
# Engine coordinates are metres with y up; Blender's are z up, so (x, y, z) becomes (x, -z, y).
import bpy, json, math, sys, os
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
args = dict(zip(argv[::2], argv[1::2]))
spec = json.load(open(args['--spec'], encoding='utf-8'))
out = args['--out']
os.makedirs(out, exist_ok=True)

def B(p):
    x, y, z = p
    return Vector((x, -z, y))

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'MATERIAL'
scene.display.shading.show_shadows = True
scene.display.shading.show_cavity = True
scene.render.resolution_x = int(spec.get('width', 960))
scene.render.resolution_y = int(spec.get('height', 544))
scene.render.fps = int(spec.get('fps', 24))
scene.frame_start = 1
scene.frame_end = int(spec.get('frames', 144))
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = os.path.join(out, '')

def mat(name, rgb):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, 1)
    return m
ground_m, prop_m, actor_m, head_m = mat('ground', (0.42, 0.42, 0.40)), mat('prop', (0.62, 0.60, 0.56)), mat('actor', (0.78, 0.74, 0.68)), mat('head', (0.85, 0.80, 0.72))

bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 0, 0))
bpy.context.object.data.materials.append(ground_m)

for pr in spec.get('props', []):
    w, h, d = float(pr.get('w', 1)), float(pr.get('h', 1)), float(pr.get('d', 1))
    loc = B((pr.get('x', 0), h / 2, pr.get('z', 0)))
    kind = pr.get('kind', 'box')
    if kind == 'cylinder':
        bpy.ops.mesh.primitive_cylinder_add(radius=w / 2, depth=h, location=loc)
    elif kind == 'plane':
        bpy.ops.mesh.primitive_plane_add(size=1, location=B((pr.get('x', 0), 0.01, pr.get('z', 0))))
        bpy.context.object.scale = (w, d, 1)
    else:
        bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
        bpy.context.object.scale = (w, d, h) if kind != 'wall' else (w, max(d, 0.2), h)
    bpy.context.object.name = pr.get('label', kind)
    bpy.context.object.data.materials.append(prop_m)

# A mannequin: torso, head, legs and arms as capsules, posed by a few named poses.
POSES = {
    'stand':   dict(lean=0, arms=10, legs=0, crouch=0),
    'walk':    dict(lean=6, arms=25, legs=22, crouch=0),
    'run':     dict(lean=16, arms=50, legs=40, crouch=0.05),
    'kneel':   dict(lean=0, arms=10, legs=0, crouch=0.45),
    'sit':     dict(lean=0, arms=15, legs=0, crouch=0.5),
    'arms-up': dict(lean=-4, arms=170, legs=0, crouch=0),
    'reach':   dict(lean=10, arms=80, legs=0, crouch=0),
    'bow':     dict(lean=45, arms=10, legs=0, crouch=0.05),
    'lie':     dict(lean=90, arms=5, legs=0, crouch=0.75),
}
def capsule(name, a, b, r, m, parent):
    a, b = Vector(a), Vector(b)
    mid, d = (a + b) / 2, b - a
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=max(d.length, 0.01), location=mid)
    o = bpy.context.object
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized() if d.length else Vector((0, 0, 1)))
    o.name = name
    o.data.materials.append(m)
    o.parent = parent
    return o

for i, a in enumerate(spec.get('actors', [])):
    pose = POSES.get(a.get('pose', 'stand'), POSES['stand'])
    root = bpy.data.objects.new(a.get('label', f'actor{i}'), None)
    scene.collection.objects.link(root)
    hip = 0.95 * (1 - pose['crouch'])
    lean = math.radians(pose['lean'])
    neck = (0, math.sin(lean) * 0.6, hip + math.cos(lean) * 0.6)
    capsule('torso', (0, 0, hip), neck, 0.17, actor_m, root)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.12, location=(neck[0], neck[1] + math.sin(lean) * 0.14, neck[2] + math.cos(lean) * 0.14))
    h = bpy.context.object; h.data.materials.append(head_m); h.parent = root
    for side in (-1, 1):
        sw = math.radians(pose['legs']) * side
        capsule('leg', (side * 0.1, 0, hip), (side * 0.1, math.sin(sw) * hip, max(0.05, hip - math.cos(sw) * hip)), 0.075, actor_m, root)
        ar = math.radians(pose['arms'])
        sh = Vector((side * 0.22, neck[1], neck[2] - 0.05))
        capsule('arm', tuple(sh), (sh.x + side * math.sin(ar) * 0.25, sh.y + 0.1, sh.z - math.cos(ar) * 0.6), 0.055, actor_m, root)
    root.location = B((a.get('x', 0), 0, a.get('z', 0)))
    root.rotation_euler = (0, 0, math.radians(a.get('heading', 0)))

cam = spec.get('camera', {})
bpy.ops.object.camera_add()
c = bpy.context.object
scene.camera = c
c.data.lens = float(cam.get('lens', 35))
target = bpy.data.objects.new('look', None)
scene.collection.objects.link(target)
target.location = B(cam.get('look', [0, 1.5, 0]))
t = c.constraints.new('TRACK_TO'); t.target = target; t.track_axis = 'TRACK_NEGATIVE_Z'; t.up_axis = 'UP_Y'
c.location = B(cam.get('from', [0, 1.6, 8]))
c.keyframe_insert('location', frame=scene.frame_start)
c.location = B(cam.get('to', cam.get('from', [0, 1.6, 8])))
c.keyframe_insert('location', frame=scene.frame_end)

sun = spec.get('sun', {'azimuth': 40, 'elevation': 35})
bpy.ops.object.light_add(type='SUN')
s = bpy.context.object
s.rotation_euler = (math.radians(90 - sun.get('elevation', 35)), 0, math.radians(sun.get('azimuth', 40)))

bpy.ops.render.render(animation=True)
print('GREYBOX_DONE', scene.frame_end)
