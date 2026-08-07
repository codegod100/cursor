# Avalon

Sample [Avalonia](https://avaloniaui.net/) desktop app (MVVM + CommunityToolkit.Mvvm).

A small temperature converter that demonstrates:

- `ObservableProperty` / `RelayCommand` source generators
- Compiled bindings (`x:DataType`)
- Fluent theme styling
- Unit swap and live conversion preview

## Requirements

- [.NET 9 SDK](https://dotnet.microsoft.com/download)

## Run

```bash
cd avalon
dotnet run
```

## Build

```bash
cd avalon
dotnet build
```

## Layout

```
avalon/
  Models/           # TemperatureUnit enum
  ViewModels/       # MainViewModel (conversion logic)
  Views/            # MainWindow.axaml UI
  Assets/           # App icon
  Program.cs        # Desktop entry point
  App.axaml         # Fluent theme + view locator
```
