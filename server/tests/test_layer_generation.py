from pathlib import Path
from PIL import Image
from app.main import create_base_layer_from_image


def test_create_base_layer_from_image_returns_silhouette():
    image_path = Path(__file__).with_name('sample.png')
    if not image_path.exists():
        image_path = Path(__file__).parent / 'sample.png'

    if not image_path.exists():
        image = Image.new('RGB', (40, 40), 'white')
        image.save(image_path)

    img = Image.open(image_path).convert('RGB')
    layer = create_base_layer_from_image(img)

    assert layer is not None
    assert layer.color == '#000000'
    assert layer.svg_path.strip() != ''
