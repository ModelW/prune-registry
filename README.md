# Prune Registry

A GitHub action to prune a Docker registry from unused tags.

Use it like:

```yaml
- name: Prune old images
  use: modelw/prune-registry@develop
  with:
      domain: your-registry.com
      username: user
      password: pwd
      regex: "^staging|production$"
```

It will basically delete all tags except:

- The tags matched by the regular expression
- The tags tagging references matching the matched tags
