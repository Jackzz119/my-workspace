---
name: blender-create
description: Use this skill when the user asks to create, modify, or export 3D models in Blender via MCP. Triggers on phrases like "在 Blender 里生成", "帮我建模", "生成场景", "调整模型", "修改贴图", "retopo", "重新布线", "绑定骨骼", "rigging", "导出 GLB", "导出 GLTF", or any request involving Blender model creation, texture adjustment, retopology, bone rigging, or exporting assets for Three.js / React Three Fiber.
version: 1.0.0
---

# blender_create 技能

## 概述

本技能指导 Claude 使用 Blender MCP 工具完成完整的 3D 资产制作流程，涵盖：
- 场景/模型生成
- 材质与贴图调整
- Retopology（重新布线）
- 骨骼绑定（Rigging）
- 导出为 GLTF/GLB 供 Three.js 使用

---

## 可用 MCP 工具

| 工具 | 用途 |
|------|------|
| `mcp__blender__execute_blender_code` | 执行任意 Blender Python 代码（核心工具） |
| `mcp__blender__get_scene_info` | 获取场景中所有物体信息 |
| `mcp__blender__get_viewport_screenshot` | 截取当前视口截图，用于预览 |
| `mcp__blender__get_object_info` | 获取单个物体的详细信息 |
| `mcp__blender__search_polyhaven_assets` | 搜索 Poly Haven 免费资产（材质/HDRi/模型） |
| `mcp__blender__download_polyhaven_asset` | 下载 Poly Haven 资产到 Blender |
| `mcp__blender__search_sketchfab_models` | 搜索 Sketchfab 模型 |
| `mcp__blender__generate_hyper3d_model_via_text` | 用文字 AI 生成 3D 模型 |
| `mcp__blender__generate_hyper3d_model_via_images` | 用图片 AI 生成 3D 模型 |
| `mcp__blender__set_texture` | 给物体设置贴图 |

---

## 工作原则

1. **分步执行**：每次 `execute_blender_code` 只做一件事，避免单次代码过长导致出错
2. **截图确认**：每个关键阶段后调用 `get_viewport_screenshot` 预览
3. **模型优先**：Three.js 会自己处理灯光，Blender 只需要模型几何体和材质颜色
4. **导出目标**：最终导出 `.glb` 文件供 Three.js `GLTFLoader` 加载

---

## 一、模型创建

### 基础辅助函数（每次代码块开头引入）

```python
import bpy
import math

def make_material(name, color, roughness=0.8, metallic=0.0, alpha=1.0):
    """创建 PBR 材质"""
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        bsdf.inputs["Transmission Weight"].default_value = 1.0 - alpha
        mat.blend_method = 'BLEND'
    return mat

def assign_mat(obj, mat):
    """给物体赋材质"""
    if obj.data.materials:
        obj.data.materials[0] = mat
    else:
        obj.data.materials.append(mat)

def make_box(name, loc, scale, mat, rot=(0,0,0)):
    """创建 Box 并赋材质"""
    bpy.ops.mesh.primitive_cube_add(location=loc, rotation=rot)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scale
    assign_mat(obj, mat)
    return obj

def make_cylinder(name, loc, radius, height, mat, verts=16):
    """创建圆柱并赋材质"""
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=height, location=loc)
    obj = bpy.context.active_object
    obj.name = name
    assign_mat(obj, mat)
    return obj
```

### 清空场景

```python
import bpy
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
# 清理孤立数据
bpy.ops.outliner.orphans_purge(do_recursive=True)
```

### 玻璃材质

```python
def make_glass(name, color=(0.75, 0.88, 0.95), alpha=0.2):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.05
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Transmission Weight"].default_value = 0.9
    bsdf.inputs["Alpha"].default_value = alpha
    mat.blend_method = 'BLEND'
    return mat
```

---

## 二、材质与贴图

### 给物体应用图片贴图

```python
import bpy

def apply_image_texture(obj_name, image_path):
    obj = bpy.data.objects[obj_name]
    mat = obj.data.materials[0] if obj.data.materials else bpy.data.materials.new("Mat")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    
    # 清理已有贴图节点
    for n in nodes:
        if n.type == 'TEX_IMAGE':
            nodes.remove(n)
    
    # 加载图片
    img = bpy.data.images.load(image_path)
    tex_node = nodes.new('ShaderNodeTexImage')
    tex_node.image = img
    tex_node.location = (-300, 300)
    
    bsdf = nodes.get("Principled BSDF")
    links.new(tex_node.outputs["Color"], bsdf.inputs["Base Color"])
    
    if not obj.data.materials:
        obj.data.materials.append(mat)
    else:
        obj.data.materials[0] = mat

apply_image_texture("Desk_Top", "C:/path/to/wood_texture.png")
```

### 从 Poly Haven 下载并应用材质

```python
# 先搜索
# mcp__blender__search_polyhaven_assets(query="wood floor", asset_type="textures")
# 然后下载
# mcp__blender__download_polyhaven_asset(asset_id="oak_floor", asset_type="textures", resolution="2k")
# 再用 set_texture 应用
# mcp__blender__set_texture(object_name="Floor", texture_id="oak_floor")
```

---

## 三、Retopology（重新布线）

Retopology 的目的是将高面数模型（高精度扫描/雕刻）转换为低面数、布线整洁的游戏/实时渲染用网格。

### 方法一：Voxel Remesh（快速，面数可控）

```python
import bpy

obj = bpy.data.objects["HighPolyMesh"]
bpy.context.view_layer.objects.active = obj

bpy.ops.object.modifier_add(type='REMESH')
mod = obj.modifiers[-1]
mod.mode = 'VOXEL'
mod.voxel_size = 0.05  # 值越小面数越高，0.05 适合中等细节
mod.use_smooth_shade = True
bpy.ops.object.modifier_apply(modifier=mod.name)

print(f"Remesh done: {len(obj.data.polygons)} polys")
```

### 方法二：Decimate（减面，保持形状）

```python
import bpy

obj = bpy.data.objects["HighPolyMesh"]
bpy.context.view_layer.objects.active = obj

bpy.ops.object.modifier_add(type='DECIMATE')
mod = obj.modifiers[-1]
mod.ratio = 0.1  # 保留 10% 面数
bpy.ops.object.modifier_apply(modifier=mod.name)

print(f"Decimate done: {len(obj.data.polygons)} polys")
```

### 方法三：Quadriflow Remesh（整洁四边面）

```python
import bpy

obj = bpy.data.objects["HighPolyMesh"]
bpy.context.view_layer.objects.active = obj
bpy.ops.object.mode_set(mode='SCULPT')

bpy.ops.sculpt.sample_detail_size(location=(0.5, 0.5), mode='BLENDER_QUADRIFLOW')
bpy.ops.sculpt.remesh()

bpy.ops.object.mode_set(mode='OBJECT')
```

### Shrinkwrap（低模贴合高模）

```python
import bpy

low_poly = bpy.data.objects["LowPoly"]
high_poly = bpy.data.objects["HighPoly"]

bpy.context.view_layer.objects.active = low_poly
bpy.ops.object.modifier_add(type='SHRINKWRAP')
mod = low_poly.modifiers[-1]
mod.target = high_poly
mod.wrap_method = 'PROJECT'
mod.use_project_z = True
bpy.ops.object.modifier_apply(modifier=mod.name)
```

### 检查网格问题

```python
import bpy
import bmesh

obj = bpy.data.objects["MyMesh"]
bm = bmesh.new()
bm.from_mesh(obj.data)

non_manifold = [e for e in bm.edges if not e.is_manifold]
poles = [v for v in bm.verts if len(v.link_edges) > 5]
print(f"Non-manifold edges: {len(non_manifold)}")
print(f"High-pole verts (>5 edges): {len(poles)}")
print(f"Total polys: {len(bm.faces)}")
bm.free()
```

---

## 四、骨骼绑定（Rigging）

### 注意事项

- **骨骼只能在 Edit Mode 下创建/编辑**
- `edit_bones` 与 `pose_bones` 是两套完全不同的对象，不要混用
- 创建完骨骼后必须回到 Object Mode 才能做父级绑定

### 完整角色绑定流程

```python
import bpy
import math

# === 第一步：创建 Armature ===
arm_data = bpy.data.armatures.new("CharacterArmature")
arm_obj = bpy.data.objects.new("Armature", arm_data)
bpy.context.collection.objects.link(arm_obj)
bpy.context.view_layer.objects.active = arm_obj
arm_obj.select_set(True)

bpy.ops.object.mode_set(mode='EDIT')
eb = arm_data.edit_bones

root = eb.new("Root")
root.head = (0, 0, 0)
root.tail = (0, 0, 0.1)

spine = eb.new("Spine")
spine.head = (0, 0, 0.5)
spine.tail = (0, 0, 0.9)
spine.parent = root

neck = eb.new("Neck")
neck.head = (0, 0, 0.9)
neck.tail = (0, 0, 1.05)
neck.parent = spine

head = eb.new("Head")
head.head = (0, 0, 1.05)
head.tail = (0, 0, 1.3)
head.parent = neck

upper_arm_l = eb.new("UpperArm_L")
upper_arm_l.head = (-0.18, 0, 0.88)
upper_arm_l.tail = (-0.38, 0, 0.70)
upper_arm_l.parent = spine

lower_arm_l = eb.new("LowerArm_L")
lower_arm_l.head = (-0.38, 0, 0.70)
lower_arm_l.tail = (-0.52, 0, 0.52)
lower_arm_l.parent = upper_arm_l

hand_l = eb.new("Hand_L")
hand_l.head = (-0.52, 0, 0.52)
hand_l.tail = (-0.60, 0, 0.44)
hand_l.parent = lower_arm_l

# 右侧对称
for bone_name in ["UpperArm_L", "LowerArm_L", "Hand_L"]:
    src = eb[bone_name]
    new_name = bone_name.replace("_L", "_R")
    new_b = eb.new(new_name)
    new_b.head = (-src.head.x, src.head.y, src.head.z)
    new_b.tail = (-src.tail.x, src.tail.y, src.tail.z)
    new_b.parent = eb[src.parent.name.replace("_L", "_R")] if "_L" in src.parent.name else src.parent

upper_leg_l = eb.new("UpperLeg_L")
upper_leg_l.head = (-0.1, 0, 0.5)
upper_leg_l.tail = (-0.1, 0, 0.28)
upper_leg_l.parent = root

lower_leg_l = eb.new("LowerLeg_L")
lower_leg_l.head = (-0.1, 0, 0.28)
lower_leg_l.tail = (-0.1, 0, 0.06)
lower_leg_l.parent = upper_leg_l

foot_l = eb.new("Foot_L")
foot_l.head = (-0.1, 0, 0.06)
foot_l.tail = (-0.1, 0.12, 0.0)
foot_l.parent = lower_leg_l

for bone_name in ["UpperLeg_L", "LowerLeg_L", "Foot_L"]:
    src = eb[bone_name]
    new_name = bone_name.replace("_L", "_R")
    new_b = eb.new(new_name)
    new_b.head = (-src.head.x, src.head.y, src.head.z)
    new_b.tail = (-src.tail.x, src.tail.y, src.tail.z)
    new_b.parent = eb[src.parent.name.replace("_L", "_R")] if "_L" in src.parent.name else src.parent

bpy.ops.object.mode_set(mode='OBJECT')
print("Armature created!")
```

### 将 Mesh 绑定到骨骼（Auto Weights）

```python
import bpy

mesh_obj = bpy.data.objects["CharacterMesh"]
arm_obj = bpy.data.objects["Armature"]

bpy.ops.object.select_all(action='DESELECT')
mesh_obj.select_set(True)
arm_obj.select_set(True)
bpy.context.view_layer.objects.active = arm_obj

bpy.ops.object.parent_set(type='ARMATURE_AUTO')
print("Mesh parented to armature with auto weights")
```

---

## 五、导出 GLTF/GLB（供 Three.js 使用）

### 导出整个场景

```python
import bpy
import os

output_path = os.path.join(os.path.expanduser("~"), "Desktop", "scene.glb")

bpy.ops.export_scene.gltf(
    filepath=output_path,
    export_format='GLB',
    export_materials='EXPORT',
    export_colors=True,
    export_cameras=False,
    export_lights=False,       # 不导出灯光，Three.js 自己打光
    export_animations=True,
    export_skins=True,
    export_apply=True,
    export_yup=True,           # Y-up 坐标系（Three.js 标准）
)
print(f"Exported to: {output_path}")
```

### 只导出选中物体

```python
import bpy
import os

bpy.ops.object.select_all(action='DESELECT')
for name in ["Desk_Top", "DeskLeg_LL_FL", "Monitor_Frame", "Chair_Seat"]:
    obj = bpy.data.objects.get(name)
    if obj:
        obj.select_set(True)

output_path = os.path.join(os.path.expanduser("~"), "Desktop", "desk_set.glb")
bpy.ops.export_scene.gltf(
    filepath=output_path,
    export_format='GLB',
    use_selection=True,
    export_apply=True,
    export_yup=True,
)
print(f"Exported selected to: {output_path}")
```

---

## 六、在 Three.js / React Three Fiber 中加载

```tsx
import { useGLTF } from '@react-three/drei'

function StudyRoom() {
  const { scene } = useGLTF('/assets/models/study_room.glb')
  return <primitive object={scene} />
}

useGLTF.preload('/assets/models/study_room.glb')
```

### 加载后调整材质

```tsx
import { useGLTF } from '@react-three/drei'
import { useEffect } from 'react'
import * as THREE from 'three'

function StudyRoom() {
  const { scene } = useGLTF('/assets/models/study_room.glb')
  
  useEffect(() => {
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true
        child.receiveShadow = true
      }
    })
  }, [scene])
  
  return <primitive object={scene} />
}
```

---

## 七、完整 Session 工作流

```
1. get_scene_info          → 了解当前场景
2. execute_blender_code    → 清空场景
3. execute_blender_code    → 建地板 + 墙壁
4. get_viewport_screenshot → 确认结构
5. execute_blender_code    → 加家具（分批，每次一组）
6. get_viewport_screenshot → 确认效果
7. execute_blender_code    → 材质/贴图调整
8. execute_blender_code    → Retopo（如需要）
9. execute_blender_code    → 骨骼绑定（如需要动画）
10. execute_blender_code   → 导出 GLB
11. 将 GLB 放入项目 public/assets/models/
12. 在 R3F 中用 useGLTF 加载
```

### 场景物件命名规范

```
[类别]_[描述]_[位置/编号]
例：
  Room_Floor
  Desk_Top / Desk_Leg_FL（Front-Left）
  Chair_Seat / Chair_Back
  Shelf_Board_01
  Book_Red_01
  Window_Glass / Window_Frame_Top
```

---

## 八、常见坑

| 问题 | 解决方法 |
|------|---------|
| `BLENDER_EEVEE_NEXT` 找不到 | 用 `BLENDER_EEVEE` 或 `CYCLES` |
| 骨骼创建报错 | 必须先进 Edit Mode：`bpy.ops.object.mode_set(mode='EDIT')` |
| 导出路径不存在 | 用绝对路径，`os.path.expanduser("~")` 确保路径有效 |
| 材质在 Three.js 里颜色偏差 | 检查 `export_yup=True`，并在 Three.js 侧开启 `renderer.outputColorSpace = THREE.SRGBColorSpace` |
| 玻璃材质不透明 | 设置 `mat.blend_method = 'BLEND'` + `Transmission Weight` |
| 模型面数过高 | 用 Decimate modifier 减面后再导出 |