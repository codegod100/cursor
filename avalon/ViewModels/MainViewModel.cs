using System;
using System.Globalization;
using Avalon.Models;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace Avalon.ViewModels;

public partial class MainViewModel : ViewModelBase
{
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ConvertedValue))]
    [NotifyCanExecuteChangedFor(nameof(ConvertCommand))]
    private string _inputValue = "20";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ConvertedValue))]
    private TemperatureUnit _fromUnit = TemperatureUnit.Celsius;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ConvertedValue))]
    private TemperatureUnit _toUnit = TemperatureUnit.Fahrenheit;

    [ObservableProperty]
    private string _statusMessage = "Enter a temperature and convert.";

    public TemperatureUnit[] Units { get; } = Enum.GetValues<TemperatureUnit>();

    public string ConvertedValue => TryParseInput(out var value)
        ? Format(ConvertTemperature(value, FromUnit, ToUnit))
        : "—";

    [RelayCommand(CanExecute = nameof(CanConvert))]
    private void Convert()
    {
        if (!TryParseInput(out var value))
        {
            StatusMessage = "Enter a valid number.";
            return;
        }

        var result = ConvertTemperature(value, FromUnit, ToUnit);
        StatusMessage = $"{Format(value)}° {FromUnit} = {Format(result)}° {ToUnit}";
        OnPropertyChanged(nameof(ConvertedValue));
    }

    [RelayCommand]
    private void SwapUnits()
    {
        (FromUnit, ToUnit) = (ToUnit, FromUnit);
        StatusMessage = "Units swapped.";
    }

    [RelayCommand]
    private void Reset()
    {
        InputValue = "20";
        FromUnit = TemperatureUnit.Celsius;
        ToUnit = TemperatureUnit.Fahrenheit;
        StatusMessage = "Reset to defaults.";
    }

    private bool CanConvert() => TryParseInput(out _);

    private bool TryParseInput(out double value) =>
        double.TryParse(InputValue, NumberStyles.Float, CultureInfo.InvariantCulture, out value);

    private static double ConvertTemperature(double value, TemperatureUnit from, TemperatureUnit to)
    {
        var celsius = from switch
        {
            TemperatureUnit.Celsius => value,
            TemperatureUnit.Fahrenheit => (value - 32) * 5 / 9,
            TemperatureUnit.Kelvin => value - 273.15,
            _ => value,
        };

        return to switch
        {
            TemperatureUnit.Celsius => celsius,
            TemperatureUnit.Fahrenheit => celsius * 9 / 5 + 32,
            TemperatureUnit.Kelvin => celsius + 273.15,
            _ => celsius,
        };
    }

    private static string Format(double value) =>
        value.ToString("0.##", CultureInfo.InvariantCulture);
}
