# Logman 详细规范

## 封装类实现（Unity C# 示例）

```csharp
public static class Logman
{
    public static void Log(string tag, string msg)
    {
#if !PRODUCTION
        Debug.Log($"{tag}\n{msg}");
#endif
    }

    public static void Warn(string tag, string msg)
    {
        Debug.LogWarning($"{tag}\n{msg}");
    }

    public static void Error(string tag, string msg)
    {
        Debug.LogError($"{tag}\n{msg}");
    }
}
```

## 使用示例

```csharp
Logman.Log("[BillDetail][Unity][BillDetailPageManager]", "收到数据: ...");
Logman.Warn("[Network][Unity][DataFetcher]", "请求超时，重试中");
Logman.Error("[FreeSpin][Unity][FreeSpinManager]", "进入失败");
```

## Pro 环境标识

Pro 环境标识方式由各项目自行决定：

| 运行时 | 常见方式 |
|--------|----------|
| Unity | Scripting Define Symbols 加入 `PRODUCTION` |
| React | `REACT_APP_ENV=production` |
| Node | `NODE_ENV=production` |

## 运行时环境标签

由项目自定义，常见示例：

| 标签 | 适用场景 |
|------|----------|
| `Unity` | Unity C# 运行时 |
| `React` | React 前端 |
| `Node` | Node.js 后端 |

## 功能域标签

功能域标签由各项目自行维护，记录在项目的 `PROJECT.md` 标签池中，skill 不内置标签列表。