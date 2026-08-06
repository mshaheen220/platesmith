from pathlib import Path
from PIL import Image
from app.main import create_base_layer_from_image, create_print_layers_from_image


def test_create_base_layer_from_image_returns_silhouette():
    image_path = Path(__file__).with_name('sample.png')
    if not image_path.exists():
        image_path = Path(__file__).parent / 'sample.png'

    image = Image.new('RGB', (40, 40), 'white')
    for x in range(8, 32):
        for y in range(8, 32):
            image.putpixel((x, y), (0, 0, 0))
    image.save(image_path)

    img = Image.open(image_path).convert('RGB')
    layer = create_base_layer_from_image(img)

    assert layer is not None
    assert layer.color == '#000000'
    assert layer.svg_path.strip() != ''


def test_create_print_layers_from_image_returns_outline_and_detail_layers():
    image = Image.new('RGB', (120, 120), 'white')
    for x in range(30, 90):
        for y in range(30, 90):
            if x in range(35, 85) and y in range(35, 85):
                continue
            image.putpixel((x, y), (0, 0, 0))
    for x in range(45, 70):
        for y in range(45, 70):
            image.putpixel((x, y), (0, 0, 0))

    layers = create_print_layers_from_image(image)

    assert len(layers) >= 2
    assert layers[0].svg_path.strip() != ''
    assert any(layer.svg_path.strip() for layer in layers[1:])


def test_create_base_layer_from_image_preserves_inner_holes():
    image = Image.new('RGB', (40, 40), 'white')
    for x in range(8, 32):
        for y in range(8, 32):
            image.putpixel((x, y), (0, 0, 0))
    for x in range(12, 28):
        for y in range(12, 28):
            if 14 <= x <= 26 and 14 <= y <= 26:
                image.putpixel((x, y), (255, 255, 255))
            else:
                image.putpixel((x, y), (0, 0, 0))

    layer = create_base_layer_from_image(image)

    assert layer is not None
    assert layer.svg_path.count('<path') >= 2


def test_create_base_layer_from_image_uses_component_color_for_colored_foreground():
    image = Image.new('RGB', (80, 80), 'white')
    for x in range(15, 65):
        for y in range(15, 65):
            image.putpixel((x, y), (255, 0, 0))

    layer = create_base_layer_from_image(image)

    assert layer is not None
    assert layer.color != '#000000'
